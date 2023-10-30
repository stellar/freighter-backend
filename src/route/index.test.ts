import { getDevServer, queryMockResponse, pubKey } from "../helper/test-helper";
import { query } from "../service/mercury/queries";

describe("API routes", () => {
  describe("/account-history/:pubKey", () => {
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

  describe("/account-balances/:pubKey", () => {
    it("can fetch account balances for a pub key & contract IDs", async () => {
      const server = await getDevServer();
      const response = await fetch(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/account-balances/${pubKey}?contract_ids=CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP`
      );
      const { data } = await response.json();
      expect(response.status).toEqual(200);
      expect(data.edges).toEqual(
        queryMockResponse["query.getAccountBalances"].edges
      );
      server.close();
    });

    it("can fetch account balances for a pub key & multiple contract IDs", async () => {
      const params = {
        contract_ids: [
          "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
          "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
        ],
      };
      const server = await getDevServer();
      const response = await fetch(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/account-balances/${pubKey}?${new URLSearchParams(
          params as any
        )}`
      );
      const { data } = await response.json();
      expect(response.status).toEqual(200);
      expect(data.edges).toEqual(
        queryMockResponse["query.getAccountBalances"].edges
      );
      server.close();
    });

    it("rejects if any contract ID is not valid", async () => {
      const params = {
        contract_ids: [
          "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
          "newp",
        ],
      };
      const server = await getDevServer();
      const response = await fetch(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/account-balances/${pubKey}?${new URLSearchParams(
          params as any
        )}`
      );
      expect(response.status).toEqual(400);
      server.close();
    });

    it("rejects requests for non strings that are not pub keys", async () => {
      const notPubkey = "newp";
      const server = await getDevServer();
      const response = await fetch(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/account-balances/${notPubkey}?contract_ids=CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP`
      );
      expect(response.status).toEqual(400);
      server.close();
    });

    it("rejects requests with bad contract IDs query param", async () => {
      const notContractId = "newp";
      const server = await getDevServer();
      const response = await fetch(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/account-balances/${pubKey}?contract_ids=${notContractId}`
      );
      expect(response.status).toEqual(400);
      server.close();
    });
  });
});
