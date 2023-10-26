import { mutation } from "./queries";
import {
  mockMercuryClient,
  queryMockResponse,
  pubKey,
} from "../../helper/test-helper";
import { xdr } from "soroban-client";

describe("Mercury Service", () => {
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

  it("can fetch account history with a payment-to in history", async () => {
    const { data } = await mockMercuryClient.getAccountHistory(pubKey);
    const paymentsToPublicKey = data?.data.paymentsToPublicKey.edges[0].node;
    expect(paymentsToPublicKey.accountByDestination.publickey).toEqual(pubKey);
    expect(paymentsToPublicKey.amount).toBe("50000000");
  });

  it("can add new full account subscription", async () => {
    const { data } = await mockMercuryClient.accountSubscription(pubKey);
    expect(pubKey).toEqual(
      data?.data.createFullAccountSubscription.fullAccountSubscription.publickey
    );
  });

  it("can build a balance ledger key for a pub key", async () => {
    const ledgerKey = mockMercuryClient.tokenBalanceKey(pubKey);
    const scVal = xdr.ScVal.fromXDR(
      Buffer.from(ledgerKey, "base64")
    ).value() as xdr.ScVal[];
    const hasPubKey = scVal.map((scVal) => {
      const inner = scVal.value() as xdr.ScMapEntry[];
      return inner.some((v) => {
        const mapVal = v.val();
        return mapVal.value()?.toString() === pubKey;
      });
    });
    expect(hasPubKey).toBeTruthy();
  });

  it("can fetch account balances by pub key", async () => {
    const contracts = ["contract-id-1", "contract-id-2"];
    const { data } = await mockMercuryClient.getAccountBalances(
      pubKey,
      contracts
    );
    expect(
      data?.data.edges.map(
        (node: { node: Record<string, string> }) => node.node.contractId
      )
    ).toEqual(contracts);
  });
});
