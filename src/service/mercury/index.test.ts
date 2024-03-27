import { Horizon, scValToNative, xdr } from "stellar-sdk";

import { mutation } from "./queries";
import {
  mockMercuryClient,
  queryMockResponse,
  pubKey,
} from "../../helper/test-helper";
import { transformAccountBalances } from "./helpers/transformers";

describe("Mercury Service", () => {
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
      data: transformedData,
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
});
