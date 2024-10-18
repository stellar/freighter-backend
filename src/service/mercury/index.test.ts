import { Horizon, Keypair, Networks, scValToNative, xdr } from "stellar-sdk";
import BigNumber from "bignumber.js";

import { mutation } from "./queries";
import {
  mockMercuryClient,
  queryMockResponse,
  pubKey,
  contractDataEntryValXdr,
} from "../../helper/test-helper";
import { transformAccountBalancesCurrentData } from "./helpers/transformers";
import { ERROR_MESSAGES } from ".";
import { ERROR } from "../../helper/error";
import * as SorobanRpcHelper from "../../helper/soroban-rpc/token";

describe("Mercury Service", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("can fetch account history with a payment-to in history", async () => {
    const { data } = await mockMercuryClient.getAccountHistory(
      pubKey,
      "TESTNET",
      true,
    );
    const payment = (data || []).find((d) => {
      if ("asset_code" in d && d.asset_code === "DT") {
        return true;
      }
      return false;
    }) as Partial<Horizon.ServerApi.PaymentOperationRecord>;
    expect(payment.amount).toEqual("5");
  });

  it("can build a balance ledger key for a pub key", async () => {
    const ledgerKey = mockMercuryClient.tokenBalanceKey(pubKey, "TESTNET");
    const scVal = xdr.ScVal.fromXDR(
      Buffer.from(ledgerKey, "base64"),
    ).value() as xdr.ScVal[];

    const [scValBalance, scValAddress] = scVal;
    const balance = scValToNative(scValBalance);
    const address = scValToNative(scValAddress);
    expect([balance, address]).toEqual(["Balance", pubKey]);
  });

  it("can fetch account balances by pub key", async () => {
    const contracts = [
      "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
      "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
    ];
    const data = await mockMercuryClient.getAccountBalances(
      pubKey,
      contracts,
      "TESTNET",
      true,
    );
    const tokenDetails = {
      CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP: {
        name: "Test Token",
        symbol: "TST",
        decimals: 7,
      },
      CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG: {
        name: "Test Token 2",
        symbol: "TST",
        decimals: 7,
      },
    };

    const transformedData = await transformAccountBalancesCurrentData(
      {
        data: queryMockResponse[
          "query.getAccountBalancesCurrentDataWithBothContracts"
        ],
      } as any,
      tokenDetails as any,
      [
        "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
        "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
      ],
      Networks.TESTNET,
    );
    const expected = {
      ...transformedData,
      error: {
        horizon: null,
        soroban: null,
      },
    };
    expect(data).toEqual(expected);
  });

  it("can renew a token", async () => {
    const response = await mockMercuryClient.renewMercuryToken("TESTNET");
    const expected = {
      data: queryMockResponse[mutation.authenticate],
      error: null,
    };
    expect(response).toEqual(expected);
    expect(mockMercuryClient.tokens["TESTNET"]).toEqual(
      queryMockResponse[mutation.authenticate].authenticate?.jwtToken,
    );
  });

  it("can retry on Mercury GraphQL 401s", async () => {
    const spyRenewToken = jest.spyOn(mockMercuryClient, "renewMercuryToken");

    const expectedResponse = { data: "success!" };
    const mockRetryable = jest.fn();
    mockRetryable.mockRejectedValueOnce(new Error(ERROR_MESSAGES.JWT_EXPIRED));
    mockRetryable.mockReturnValue(expectedResponse);
    const response = await mockMercuryClient.renewAndRetry<
      typeof expectedResponse
    >(mockRetryable, "TESTNET");

    expect(response).toEqual(expectedResponse);
    expect(mockRetryable).toHaveBeenCalledTimes(2);
    expect(spyRenewToken).toHaveBeenCalled();
  });

  it("can retry on Mercury subscription 401s", async () => {
    const spyRenewToken = jest.spyOn(mockMercuryClient, "renewMercuryToken");

    const expectedResponse = { data: "success!" };
    const mockRetryable = jest.fn();
    mockRetryable.mockRejectedValueOnce({ response: { status: 401 } });
    mockRetryable.mockReturnValue(expectedResponse);
    const response = await mockMercuryClient.renewAndRetry<
      typeof expectedResponse
    >(mockRetryable, "TESTNET");

    expect(response).toEqual(expectedResponse);
    expect(mockRetryable).toHaveBeenCalledTimes(2);
    expect(spyRenewToken).toHaveBeenCalled();
  });

  it("will rethrow non 401 errors when !retryCount", async () => {
    const err = "Unexpected";
    const spyRenewToken = jest.spyOn(mockMercuryClient, "renewMercuryToken");

    const mockRetryable = jest.fn();
    mockRetryable.mockRejectedValue(new Error(err));

    await expect(
      mockMercuryClient.renewAndRetry(mockRetryable, "TESTNET"),
    ).rejects.toThrowError(err);
    expect(mockRetryable).toHaveBeenCalledTimes(1);
    expect(spyRenewToken).not.toHaveBeenCalled();
  });

  it("will retry non 401s when retryCount is passed", async () => {
    const err = "Unexpected";
    const RETRY_COUNT = 5;
    const spyRenewToken = jest.spyOn(mockMercuryClient, "renewMercuryToken");

    const expectedResponse = { data: "success!" };
    const mockRetryable = jest.fn();
    mockRetryable.mockRejectedValueOnce(new Error(err));
    mockRetryable.mockReturnValue(expectedResponse);
    const response = await mockMercuryClient.renewAndRetry<
      typeof expectedResponse
    >(mockRetryable, "TESTNET", RETRY_COUNT);

    expect(response).toEqual(expectedResponse);
    // It would retry 5 times, but we can only mock reject once or all so it rejects once, then succeeds.
    expect(mockRetryable).toHaveBeenCalledTimes(2);
    expect(spyRenewToken).not.toHaveBeenCalled();
  });

  it("will correctly handle missing account subscriptions when fetching history", async () => {
    jest
      .spyOn(mockMercuryClient, "getAccountSubForPubKey")
      .mockImplementation(
        (
          ..._args: Parameters<typeof mockMercuryClient.getAccountSubForPubKey>
        ): ReturnType<typeof mockMercuryClient.getAccountSubForPubKey> => {
          return Promise.resolve([{ publickey: "nope" }]);
        },
      );

    jest
      .spyOn(mockMercuryClient, "accountSubscription")
      .mockImplementation(
        (
          ..._args: Parameters<typeof mockMercuryClient.accountSubscription>
        ): ReturnType<typeof mockMercuryClient.accountSubscription> => {
          return Promise.resolve({ data: {}, error: null });
        },
      );

    const response = await mockMercuryClient.getAccountHistoryMercury(
      pubKey,
      "TESTNET",
    );
    expect(response).toHaveProperty("error");
    expect(response.error).toBeInstanceOf(Error);
    if (response.error instanceof Error) {
      expect(response.error.message).toContain(ERROR.MISSING_SUB_FOR_PUBKEY);
    }
    expect(mockMercuryClient.accountSubscription).toHaveBeenCalled();
  });

  it("can properly key SAC balances by asset issuer", async () => {
    const contracts = [
      "CAP5AMC2OHNVREO66DFIN6DHJMPOBAJ2KCDDIMFBR7WWJH5RZBFM3UEI",
      "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
    ];
    jest
      .spyOn(SorobanRpcHelper, "getTokenBalance")
      .mockReturnValue(Promise.resolve(100));
    jest
      .spyOn(SorobanRpcHelper, "getTokenBalance")
      .mockReturnValue(Promise.resolve(100));
    // first contract
    jest.spyOn(mockMercuryClient, "tokenDetails").mockReturnValueOnce(
      Promise.resolve({
        name: "wBTC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
        symbol: "wBTC",
        decimals: "5",
      }),
    );
    //second contract
    jest.spyOn(mockMercuryClient, "tokenDetails").mockReturnValueOnce(
      Promise.resolve({
        name: "baz",
        symbol: "BAZ",
        decimals: "5",
      }),
    );

    const data = await mockMercuryClient.getTokenBalancesSorobanRPC(
      pubKey,
      contracts,
      "TESTNET",
    );

    const expected = {
      "wBTC:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56": {
        token: {
          code: "wBTC",
          issuer: {
            key: "CAP5AMC2OHNVREO66DFIN6DHJMPOBAJ2KCDDIMFBR7WWJH5RZBFM3UEI",
          },
        },
        contractId: "CAP5AMC2OHNVREO66DFIN6DHJMPOBAJ2KCDDIMFBR7WWJH5RZBFM3UEI",
        symbol: "wBTC",
        decimals: "5",
        total: new BigNumber(100),
        available: new BigNumber(100),
      },
      "BAZ:CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG": {
        token: {
          code: "BAZ",
          issuer: {
            key: "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
          },
        },
        contractId: "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
        symbol: "BAZ",
        decimals: "5",
        total: new BigNumber(100),
        available: new BigNumber(100),
      },
    };

    expect(data).toEqual(expected);
  });

  it("can remove duplicate balances for SACs", async () => {
    const contracts = [
      "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
      "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
    ];
    jest
      .spyOn(mockMercuryClient, "getAccountBalancesHorizon")
      .mockImplementation(
        (
          ..._args: Parameters<
            typeof mockMercuryClient.getAccountBalancesHorizon
          >
        ): any => {
          return Promise.resolve({
            balances: {
              "yXLM:GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55": {
                available: "1.0023247",
                buyingLiabilities: "0",
                limit: "922337203685.4775807",
                sellingLiabilities: "0",
                token: {
                  type: "credit_alphanum4",
                  code: "yXLM",
                  issuer: {
                    key: "GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55",
                  },
                  total: "1.0023247",
                },
              },
            },
            id: "",
            network: "TESTNET",
            subentryCount: 1,
            sponsoredCount: 0,
            sponsoringCount: 0,
            sponsor: "",
          });
        },
      );
    jest
      .spyOn(mockMercuryClient, "getTokenBalancesSorobanRPC")
      .mockImplementation(
        (
          ..._args: Parameters<
            typeof mockMercuryClient.getTokenBalancesSorobanRPC
          >
        ): any => {
          return Promise.resolve({
            "FOO:CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP": {
              token: {
                code: "FOO",
                issuer: {
                  key: "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
                },
                total: "1",
              },
            },
            "yXLM:GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55": {
              token: {
                code: "yXLM",
                issuer: {
                  key: "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
                },
                total: "1",
              },
            },
          });
        },
      );

    const data = await mockMercuryClient.getAccountBalances(
      pubKey,
      contracts,
      "TESTNET",
      false,
    );

    const expected = {
      error: {
        horizon: null,
        soroban: null,
      },
      isFunded: true,
      subentryCount: 1,
      balances: {
        "FOO:CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP": {
          token: {
            code: "FOO",
            issuer: {
              key: "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
            },
            total: "1",
          },
        },
        "yXLM:GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55": {
          available: "1.0023247",
          buyingLiabilities: "0",
          limit: "922337203685.4775807",
          sellingLiabilities: "0",
          token: {
            type: "credit_alphanum4",
            code: "yXLM",
            issuer: {
              key: "GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55",
            },
            total: "1.0023247",
          },
        },
      },
    };
    expect(data).toEqual(expected);
  });

  it("can remove duplicate balances when using Mercury", async () => {
    const sacInstance = {
      contract: "CAP5AMC2OHNVREO66DFIN6DHJMPOBAJ2KCDDIMFBR7WWJH5RZBFM3UEI",
      issuer: "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
      code: "wBTC",
    };
    const contracts = [sacInstance.contract];

    const tokenDetails = {
      [`${sacInstance.contract}`]: {
        name: `${sacInstance.code}:${sacInstance.issuer}`,
        symbol: sacInstance.code,
        decimals: "7",
      },
    };

    const issuer = Keypair.fromPublicKey(sacInstance.issuer).xdrAccountId();
    const alpha = new xdr.AlphaNum4({
      assetCode: Buffer.from(sacInstance.code),
      issuer,
    });
    const asset = xdr.Asset.assetTypeCreditAlphanum4(alpha);

    const rawResponse = {
      data: {
        ...queryMockResponse["query.getAccountBalancesCurrentData"],
        trustlinesByPublicKey: [
          ...queryMockResponse["query.getAccountBalancesCurrentData"]
            .trustlinesByPublicKey,
          {
            balance: 100019646386,
            asset: asset.toXDR("base64"),
            limit: 1,
            accountId: pubKey,
          },
        ],
        [sacInstance.contract]: [
          {
            contractId: sacInstance.contract,
            keyXdr:
              "AAAAEAAAAAEAAAACAAAADwAAAAdCYWxhbmNlAAAAABIAAAAAAAAAAIzohH0YeJGhVUA7vwkk2SzLZ8oNA2zaMGfxtpyxEtys",
            valXdr: contractDataEntryValXdr,
            durability: 1,
          },
        ],
      },
    };

    const transformedResponse = await transformAccountBalancesCurrentData(
      rawResponse as any,
      tokenDetails,
      contracts,
      Networks.TESTNET,
    );
    const wBtcBalances = Object.keys(transformedResponse.balances).filter(
      (key) => key.includes("wBTC"),
    );
    expect(wBtcBalances).toHaveLength(1);
  });
});
