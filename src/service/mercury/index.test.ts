import { Horizon, scValToNative, xdr } from "stellar-sdk";

import { mutation } from "./queries";
import {
  mockMercuryClient,
  queryMockResponse,
  pubKey,
} from "../../helper/test-helper";
import { transformAccountBalances } from "./helpers/transformers";
import { ERROR_MESSAGES } from ".";

describe.only("Mercury Service", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("can fetch account history with a payment-to in history", async () => {
    const { data } = await mockMercuryClient.getAccountHistory(
      pubKey,
      "TESTNET",
      true
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
    const ledgerKey = mockMercuryClient.tokenBalanceKey(pubKey);
    const scVal = xdr.ScVal.fromXDR(
      Buffer.from(ledgerKey, "base64")
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
      true
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
    const transformedData = await transformAccountBalances(
      { data: queryMockResponse["query.getAccountBalances"] } as any,
      tokenDetails as any
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
    expect(mockMercuryClient.mercurySession.token).toEqual(
      queryMockResponse[mutation.authenticate].authenticate?.jwtToken
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
      mockMercuryClient.renewAndRetry(mockRetryable, "TESTNET")
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

  it("getAccountBalancesMercury throws when there is no sub for public key", async () => {
    jest
      .spyOn(mockMercuryClient, "getAccountSubForPubKey")
      .mockImplementation(
        (
          ..._args: Parameters<typeof mockMercuryClient.getAccountSubForPubKey>
        ): ReturnType<typeof mockMercuryClient.getAccountSubForPubKey> => {
          return Promise.resolve([{ publickey: "nope" }]);
        }
      );

    const response = await mockMercuryClient.getAccountBalancesMercury(
      pubKey,
      [],
      "TESTNET"
    );
    expect(response).toHaveProperty("error");
    expect(response.error).toBeInstanceOf(Error);
    if (response.error instanceof Error) {
      expect(response.error.message).toContain(
        "Tried to query for data without a subscription setup for a public key"
      );
    }
  });
});
