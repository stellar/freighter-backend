import { mutation } from "./queries";
import {
  mockMercuryClient,
  queryMockResponse,
  pubKey,
} from "../../helper/test-helper";

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
    const { data } = await mockMercuryClient.addNewAccountSubscription(pubKey);
    expect(pubKey).toEqual(
      data?.data.createFullAccountSubscription.fullAccountSubscription.publickey
    );
  });
});
