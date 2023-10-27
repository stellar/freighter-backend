import { getDevServer, queryMockResponse, pubKey } from "../helper/test-helper";
import { query } from "../service/mercury/queries";

describe("API routes", () => {
  describe("/account-history/:pub-key", () => {
    it("can fetch an account history for a pub key", async () => {
      const server = await getDevServer();
      const response = await fetch(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/account-history/${pubKey}`
      );
      const { data } = await response.json();
      expect(response.status).toEqual(200);
      expect(data).toMatchObject(queryMockResponse[query.getAccountHistory]);
      server.close();
    });

    it("rejects requests for non strings that are not pub keys", async () => {
      const notPubkey = "newp";
      const server = await getDevServer();
      const response = await fetch(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/account-history/${notPubkey}`
      );
      expect(response.status).toEqual(400);
      server.close();
    });
  });
});
