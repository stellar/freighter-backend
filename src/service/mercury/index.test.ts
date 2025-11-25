import { Horizon, Keypair, Networks, scValToNative, xdr } from "stellar-sdk";
import BigNumber from "bignumber.js";

import { mutation } from "./queries";
import {
  mockMercuryClient,
  queryMockResponse,
  pubKey,
  contractDataEntryValXdr,
  TEST_SOROBAN_TX,
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
        decimals: "7",
      },
      CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG: {
        name: "Test Token 2",
        symbol: "TST",
        decimals: "7",
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

  it.skip("can properly key SAC balances by asset issuer", async () => {
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
  it.skip("can get token details with balance", async () => {
    const testPubKey =
      "GCGORBD5DB4JDIKVIA536CJE3EWMWZ6KBUBWZWRQM7Y3NHFRCLOKYVAL";
    const testContractId =
      "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP";
    const testNetwork = "TESTNET" as const;

    jest
      .spyOn(SorobanRpcHelper, "getTokenBalance")
      .mockReturnValue(Promise.resolve(1000000));

    const response = await mockMercuryClient.tokenDetails(
      testPubKey,
      testContractId,
      testNetwork,
      true,
    );

    expect(response).toEqual({
      name: "Test Contract",
      decimals: "7",
      symbol: "TST",
      balance: "1000000",
    });
  });

  it.skip("can get token details without balance when shouldFetchBalance is false", async () => {
    const testPubKey =
      "GCGORBD5DB4JDIKVIA536CJE3EWMWZ6KBUBWZWRQM7Y3NHFRCLOKYVAL";
    const testContractId =
      "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP";
    const testNetwork = "TESTNET" as const;

    const response = await mockMercuryClient.tokenDetails(
      testPubKey,
      testContractId,
      testNetwork,
      false,
    );

    expect(response).toEqual({
      name: "Test Contract",
      decimals: "7",
      symbol: "TST",
    });
  });

  it("can get token details without balance when shouldFetchBalance is undefined", async () => {
    const testPubKey =
      "GCGORBD5DB4JDIKVIA536CJE3EWMWZ6KBUBWZWRQM7Y3NHFRCLOKYVAL";
    const testContractId =
      "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP";
    const testNetwork = "TESTNET" as const;

    const response = await mockMercuryClient.tokenDetails(
      testPubKey,
      testContractId,
      testNetwork,
    );

    expect(response).toEqual({
      name: "Test Contract",
      decimals: "7",
      symbol: "TST",
    });
  });

  it("returns token details with balance when shouldFetchBalance is true", async () => {
    const testPubKey =
      "GCGORBD5DB4JDIKVIA536CJE3EWMWZ6KBUBWZWRQM7Y3NHFRCLOKYVAL";
    const testContractId =
      "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP";
    const testNetwork = "TESTNET" as const;

    const response = await mockMercuryClient.tokenDetails(
      testPubKey,
      testContractId,
      testNetwork,
      true,
    );

    expect(response).toEqual({
      name: "Test Contract",
      decimals: "7",
      symbol: "TST",
      balance: "1000000",
    });
  });

  describe("getAccountHistory - Blockaid Scanning", () => {
    // Helper to create mock Soroban operations
    const createMockSorobanOperation = (overrides: any = {}) => ({
      id: overrides.id || "op-12345",
      type: "invoke_host_function",
      transaction_hash: overrides.transaction_hash || "test-hash-123",
      transaction_attr: {
        envelope_xdr: overrides.envelope_xdr || TEST_SOROBAN_TX,
        ...overrides.transaction_attr,
      },
      created_at: "2024-01-01T00:00:00Z",
      source_account: pubKey,
      ...overrides,
    });

    // Helper to create mock payment operations
    const createMockPaymentOperation = (overrides: any = {}) => ({
      id: overrides.id || "op-payment-1",
      type: "payment",
      transaction_hash: "payment-hash",
      asset_code: "USDC",
      amount: "100",
      from: pubKey,
      to: "GBXXXX",
      ...overrides,
    });

    // Mock successful scan response
    const mockSuccessfulScan = {
      data: {
        simulation: {
          status: "Success",
          assets_diffs: {
            native: [
              {
                asset: { type: "native" },
                in: { raw_value: "0" },
                out: { raw_value: "1000000" },
              },
            ],
          },
        },
        validation: {
          result_type: "Benign",
        },
      },
      error: null,
    };

    // Mock failed simulation (status !== "Success")
    const mockNonSuccessScan = {
      data: {
        simulation: {
          status: "Failed",
          assets_diffs: {},
        },
        validation: {
          result_type: "Benign",
        },
      },
      error: null,
    };

    it("scans Soroban operations and adds asset_diffs when scan succeeds", async () => {
      const mockOp = createMockSorobanOperation();
      jest
        .spyOn(mockMercuryClient, "getAccountHistoryHorizon")
        .mockResolvedValue({
          data: [mockOp],
          error: null,
        });

      const scanTxSpy = jest
        .spyOn(mockMercuryClient.blockAidService, "scanTx")
        .mockResolvedValue(mockSuccessfulScan as any);

      const result = await mockMercuryClient.getAccountHistory(
        pubKey,
        "TESTNET",
        false, // useMercury=false to force Horizon path
      );

      expect(scanTxSpy).toHaveBeenCalledWith(TEST_SOROBAN_TX, "", "TESTNET");
      expect(result.data).toHaveLength(1);
      expect((result.data![0] as any).asset_diffs).toEqual(
        mockSuccessfulScan.data.simulation.assets_diffs,
      );
    });

    it("only scans invoke_host_function operations", async () => {
      const mockPayment = createMockPaymentOperation();
      const mockSoroban = createMockSorobanOperation({ id: "op-soroban-1" });
      const mockPayment2 = createMockPaymentOperation({ id: "op-payment-2" });

      jest
        .spyOn(mockMercuryClient, "getAccountHistoryHorizon")
        .mockResolvedValue({
          data: [mockPayment, mockSoroban, mockPayment2],
          error: null,
        });

      const scanTxSpy = jest
        .spyOn(mockMercuryClient.blockAidService, "scanTx")
        .mockResolvedValue(mockSuccessfulScan as any);

      const result = await mockMercuryClient.getAccountHistory(
        pubKey,
        "TESTNET",
        false,
      );

      // scanTx should only be called once for the Soroban operation
      expect(scanTxSpy).toHaveBeenCalledTimes(1);
      expect(scanTxSpy).toHaveBeenCalledWith(TEST_SOROBAN_TX, "", "TESTNET");

      // Payment operations should not have asset_diffs
      expect((result.data![0] as any).asset_diffs).toBeUndefined();
      expect((result.data![2] as any).asset_diffs).toBeUndefined();

      // Soroban operation should have asset_diffs
      expect((result.data![1] as any).asset_diffs).toEqual(
        mockSuccessfulScan.data.simulation.assets_diffs,
      );
    });

    it("continues when scanTx throws an error", async () => {
      const mockOp1 = createMockSorobanOperation({
        id: "op-1",
        transaction_hash: "hash-1",
      });
      const mockOp2 = createMockSorobanOperation({
        id: "op-2",
        transaction_hash: "hash-2",
      });

      jest
        .spyOn(mockMercuryClient, "getAccountHistoryHorizon")
        .mockResolvedValue({
          data: [mockOp1, mockOp2],
          error: null,
        });

      jest
        .spyOn(mockMercuryClient.blockAidService, "scanTx")
        .mockRejectedValueOnce(new Error("Scan failed"))
        .mockResolvedValueOnce(mockSuccessfulScan as any);

      const loggerSpy = jest.spyOn(mockMercuryClient.logger, "error");

      const result = await mockMercuryClient.getAccountHistory(
        pubKey,
        "TESTNET",
        false,
      );

      // Function should complete successfully
      expect(result.data).toHaveLength(2);

      // First operation should not have asset_diffs
      expect((result.data![0] as any).asset_diffs).toBeUndefined();

      // Second operation should have asset_diffs
      expect((result.data![1] as any).asset_diffs).toEqual(
        mockSuccessfulScan.data.simulation.assets_diffs,
      );

      // Logger should be called with error details
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: "Failed to scan Soroban transaction",
          transaction_hash: "hash-1",
        }),
      );
    });

    it("does not add asset_diffs when simulation status is not Success", async () => {
      const mockOp = createMockSorobanOperation();
      jest
        .spyOn(mockMercuryClient, "getAccountHistoryHorizon")
        .mockResolvedValue({
          data: [mockOp],
          error: null,
        });

      const scanTxSpy = jest
        .spyOn(mockMercuryClient.blockAidService, "scanTx")
        .mockResolvedValue(mockNonSuccessScan as any);

      const loggerSpy = jest.spyOn(mockMercuryClient.logger, "error");

      const result = await mockMercuryClient.getAccountHistory(
        pubKey,
        "TESTNET",
        false,
      );

      // scanTx should be called
      expect(scanTxSpy).toHaveBeenCalledWith(TEST_SOROBAN_TX, "", "TESTNET");

      // Operation should not have asset_diffs
      expect((result.data![0] as any).asset_diffs).toBeUndefined();

      // No error should be logged (this is expected behavior)
      expect(loggerSpy).not.toHaveBeenCalled();
    });

    it("skips scanning when envelope_xdr is missing", async () => {
      const mockOp = createMockSorobanOperation({
        transaction_attr: {},
      });

      jest
        .spyOn(mockMercuryClient, "getAccountHistoryHorizon")
        .mockResolvedValue({
          data: [mockOp],
          error: null,
        });

      jest.spyOn(mockMercuryClient.blockAidService, "scanTx");

      const result = await mockMercuryClient.getAccountHistory(
        pubKey,
        "TESTNET",
        false,
      );

      // Operation should be returned unchanged
      expect((result.data![0] as any).asset_diffs).toBeUndefined();
    });

    it("handles mixed success and failure in Promise.allSettled", async () => {
      const mockOp1 = createMockSorobanOperation({
        id: "op-1",
        transaction_hash: "hash-1",
      });
      const mockOp2 = createMockSorobanOperation({
        id: "op-2",
        transaction_hash: "hash-2",
      });
      const mockOp3 = createMockSorobanOperation({
        id: "op-3",
        transaction_hash: "hash-3",
      });

      jest
        .spyOn(mockMercuryClient, "getAccountHistoryHorizon")
        .mockResolvedValue({
          data: [mockOp1, mockOp2, mockOp3],
          error: null,
        });

      jest
        .spyOn(mockMercuryClient.blockAidService, "scanTx")
        .mockResolvedValueOnce(mockSuccessfulScan as any)
        .mockRejectedValueOnce(new Error("Scan failed"))
        .mockResolvedValueOnce(mockSuccessfulScan as any);

      const loggerSpy = jest.spyOn(mockMercuryClient.logger, "error");

      const result = await mockMercuryClient.getAccountHistory(
        pubKey,
        "TESTNET",
        false,
      );

      // All operations should be in response
      expect(result.data).toHaveLength(3);

      // Operations 1 and 3 should have asset_diffs
      expect((result.data![0] as any).asset_diffs).toEqual(
        mockSuccessfulScan.data.simulation.assets_diffs,
      );
      expect((result.data![2] as any).asset_diffs).toEqual(
        mockSuccessfulScan.data.simulation.assets_diffs,
      );

      // Operation 2 should not have asset_diffs
      expect((result.data![1] as any).asset_diffs).toBeUndefined();

      // Logger should be called once for the failure
      expect(loggerSpy).toHaveBeenCalledTimes(1);
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: "Failed to scan Soroban transaction",
          transaction_hash: "hash-2",
        }),
      );
    });

    it("handles empty history response", async () => {
      jest
        .spyOn(mockMercuryClient, "getAccountHistoryHorizon")
        .mockResolvedValue({
          data: [],
          error: null,
        });

      const scanTxSpy = jest.spyOn(mockMercuryClient.blockAidService, "scanTx");

      const result = await mockMercuryClient.getAccountHistory(
        pubKey,
        "TESTNET",
        false,
      );

      // scanTx should not be called
      expect(scanTxSpy).not.toHaveBeenCalled();

      // Empty array should be returned
      expect(result.data).toEqual([]);
      expect(result.error).toBeNull();
    });
  });
});
