import "@blockaid/client";
import {
  getDevServer,
  queryMockResponse,
  pubKey,
  register,
} from "../helper/test-helper";
import { transformAccountHistory } from "../service/mercury/helpers/transformers";
import { query } from "../service/mercury/queries";

jest.mock("@blockaid/client", () => {
  return class Blockaid {
    token = {
      scan: (asset: { address: string; chain: string }) => {
        if (
          asset.address ===
          "BLND-GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56"
        ) {
          return Promise.resolve({ malicious_score: 1 });
        }
        if (
          asset.address ===
          "TST-CDP3XWJ4ZN222LKYBMWIY3GYXZYX3KA6WVNDS6V7WKXSYWLAEMYW7DTZ"
        ) {
          throw Error("ERROR");
        }
        return Promise.resolve({ malicious_score: 0 });
      },
    };
  };
});

describe("API routes", () => {
  describe("/account-history/:pubKey", () => {
    it("can fetch an account history for a pub key", async () => {
      const server = await getDevServer();
      const response = await fetch(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/account-history/${pubKey}?network=TESTNET&soroban_rpc_url=rpc_url`
      );
      const data = await response.json();
      expect(response.status).toEqual(200);
      expect(data).toMatchObject(
        transformAccountHistory(
          {
            data: queryMockResponse[query.getAccountHistory],
          } as any,
          "TESTNET"
        )
      );
      register.clear();
      await server.close();
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
      register.clear();
      await server.close();
    });
  });

  describe("/account-balances/:pubKey", () => {
    it("can fetch account balances for a pub key & contract IDs", async () => {
      const server = await getDevServer();
      const response = await fetch(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/account-balances/${pubKey}?contract_ids=CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP&network=TESTNET`
      );
      expect(response.status).toEqual(200);
      register.clear();
      await server.close();
    });

    it("can fetch account balances for a pub key & multiple contract IDs", async () => {
      const contractIds = [
        "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
        "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
      ];
      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/account-balances/${pubKey}`
      );
      url.searchParams.append("network", "TESTNET");
      for (const id of contractIds) {
        url.searchParams.append("contract_ids", id);
      }
      const response = await fetch(url.href);
      expect(response.status).toEqual(200);
      register.clear();
      await server.close();
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
      register.clear();
      await server.close();
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
      register.clear();
      await server.close();
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
      register.clear();
      await server.close();
    });

    it("adds scanned status on Pubnet", async () => {
      const contractIds = [
        "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
        "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
      ];
      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/account-balances/${pubKey}`
      );
      url.searchParams.append("network", "PUBLIC");
      for (const id of contractIds) {
        url.searchParams.append("contract_ids", id);
      }
      const response = await fetch(url.href);
      const data = await response.json();

      expect(response.status).toEqual(200);
      expect(
        data.balances[
          "BLND:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56"
        ].isMalicious
      ).toEqual(true);
      expect(
        data.balances[
          "TST:CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP"
        ].isMalicious
      ).toEqual(false);
      register.clear();
      await server.close();
    });
    it("doesn't check scanned status on Testnet", async () => {
      const contractIds = [
        "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
        "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
      ];
      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/account-balances/${pubKey}`
      );
      url.searchParams.append("network", "TESTNET");
      for (const id of contractIds) {
        url.searchParams.append("contract_ids", id);
      }
      const response = await fetch(url.href);
      const data = await response.json();

      expect(response.status).toEqual(200);
      expect(
        data.balances[
          "BLND:GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56"
        ].isMalicious
      ).toEqual(false);
      register.clear();
      await server.close();
    });
    it("defaults to not malicious on scan status error", async () => {
      const contractIds = [
        "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
        "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
        "CDP3XWJ4ZN222LKYBMWIY3GYXZYX3KA6WVNDS6V7WKXSYWLAEMYW7DTZ",
      ];
      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/account-balances/${pubKey}`
      );
      url.searchParams.append("network", "PUBLIC");
      for (const id of contractIds) {
        url.searchParams.append("contract_ids", id);
      }
      const response = await fetch(url.href);
      const data = await response.json();

      expect(response.status).toEqual(200);
      expect(
        data.balances[
          "TST:CDP3XWJ4ZN222LKYBMWIY3GYXZYX3KA6WVNDS6V7WKXSYWLAEMYW7DTZ"
        ].isMalicious
      ).toEqual(false);
      register.clear();
      await server.close();
    });
  });
});
