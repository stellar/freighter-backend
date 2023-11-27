import { scValToNative, xdr } from "soroban-client";

import { mutation } from "./queries";
import {
  mockMercuryClient,
  queryMockResponse,
  pubKey,
} from "../../helper/test-helper";

describe("Mercury Service", () => {
  it("can fetch account history with a payment-to in history", async () => {
    const { data } = await mockMercuryClient.getAccountHistory(pubKey);
    const paymentsToPublicKey = data?.data.paymentsToPublicKey.edges[0].node;
    expect(paymentsToPublicKey.accountByDestination.publickey).toEqual(pubKey);
    expect(paymentsToPublicKey.amount).toBe("50000000");
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

  it.skip("can fetch account balances by pub key", async () => {
    const contracts = [
      "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
      "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
    ];
    const data = await mockMercuryClient.getAccountBalances(
      pubKey,
      contracts,
      "TESTNET"
    );
    console.log(data);
  });

  it("can renew a token", async () => {
    const response = await mockMercuryClient.renewMercuryToken();
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
