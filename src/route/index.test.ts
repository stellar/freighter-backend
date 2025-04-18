import * as StellarSdk from "stellar-sdk";
import "@blockaid/client";
import {
  getDevServer,
  queryMockResponse,
  pubKey,
  TEST_SOROBAN_TX,
} from "../helper/test-helper";
import { transformAccountHistory } from "../service/mercury/helpers/transformers";
import { query } from "../service/mercury/queries";
import { defaultBenignResponse } from "../service/blockaid/helpers/addScanResults";
import { Networks } from "stellar-sdk-next";
import { ERROR } from "../helper/error";
import * as StellarHelpers from "../helper/stellar";
import * as OnrampHelpers from "../helper/onramp";
import { getStellarRpcUrls } from "../helper/soroban-rpc";
import { StellarRpcConfig } from "../config";

const mockStellarRpcConfig = {
  freighterRpcPubnetUrl: "https://rpc-pubnet.stellar.org",
  freighterRpcTestnetUrl: "https://rpc-testnet.stellar.org",
  freighterRpcFuturenetUrl: "https://rpc-futurenet.stellar.org",
} as StellarRpcConfig;

jest.mock("@blockaid/client", () => {
  return class Blockaid {
    tokenBulk = {
      scan: (asset: { tokens: string[]; chain: string }) => {
        const res: { [key: string]: any } = {};
        asset.tokens.forEach((address) => {
          if (
            address ===
            "TST-CDP3XWJ4ZN222LKYBMWIY3GYXZYX3KA6WVNDS6V7WKXSYWLAEMYW7DTZ"
          ) {
            throw Error("ERROR");
          }

          if (
            address ===
            "BLND-GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56"
          ) {
            res[address] = {
              result_type: "Malicious",
              malicious_score: 1,
            };
            return;
          }

          res[address] = {
            result_type: "Benign",
            malicious_score: 0,
          };
        });

        return Promise.resolve({ results: res });
      },
    };
    token = {
      scan: ({ address }: { address: string }) => {
        if (
          address ===
          "BLND-GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56"
        ) {
          return Promise.resolve({
            result_type: "Malicious",
            malicious_score: 1,
          });
        }

        return Promise.resolve({
          result_type: "Benign",
          malicious_score: 0,
        });
      },
      report: () => Promise.resolve(999),
    };
    stellar = {
      transaction: {
        scan: () => ({
          withResponse: () =>
            Promise.resolve({
              data: {
                simulation: {
                  status: "Success",
                  assets_diffs: {},
                  exposures: {},
                  ownership_diffs: {},
                  address_details: [],
                  account_summary: [],
                },
                validation: {
                  status: "Success",
                  result_type: "Benign",
                  description: "",
                  reason: "",
                  classification: "",
                  features: [],
                },
              },
              response: {
                status: 200,
                statusText: "OK",
                headers: {
                  get: () => ({
                    "x-request-id": "1214",
                  }),
                  "x-request-id": "1214",
                },
                bodyUsed: true,
                ok: true,
                redirected: false,
                type: "basic",
                url: "https://api.blockaid.io/v0/stellar/transaction/scan",
              },
            }),
        }),
        report: () => Promise.resolve(999),
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
        }/api/v1/account-history/${pubKey}?network=TESTNET&soroban_rpc_url=rpc_url`,
      );
      const data = await response.json();
      expect(response.status).toEqual(200);
      expect(data).toMatchObject(
        transformAccountHistory(
          {
            data: queryMockResponse[query.getAccountHistory],
          } as any,
          "TESTNET",
        ),
      );
      await server.close();
    });

    it("rejects requests for non strings that are not pub keys", async () => {
      const notPubkey = "newp";
      const server = await getDevServer();
      const response = await fetch(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/account-history/${notPubkey}`,
      );
      expect(response.status).toEqual(400);
      await server.close();
    });
  });
  describe("/token-details/:contractId", () => {
    it("can fetch token details for a contract ID with pub_key", async () => {
      const contractId =
        "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP";
      const server = await getDevServer();
      const response = await fetch(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/token-details/${contractId}?network=TESTNET&pub_key=${pubKey}`,
      );
      expect(response.status).toEqual(200);
      await server.close();
    });

    it("can fetch token details with balance when should_fetch_balance=true", async () => {
      const contractId =
        "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP";
      const server = await getDevServer();
      const response = await fetch(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/token-details/${contractId}?network=TESTNET&pub_key=${pubKey}&should_fetch_balance=true`,
      );
      expect(response.status).toEqual(200);
      await server.close();
    });

    it("uses redis cache for static token details when should_fetch_balance=false", async () => {
      const contractId =
        "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP";
      const server = await getDevServer();

      // First request should cache the static details
      const response1 = await fetch(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/token-details/${contractId}?network=TESTNET&pub_key=${pubKey}`,
      );
      const data1 = await response1.json();
      expect(response1.status).toEqual(200);

      // Second request should use cached data
      const response2 = await fetch(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/token-details/${contractId}?network=TESTNET&pub_key=${pubKey}`,
      );
      const data2 = await response2.json();
      expect(response2.status).toEqual(200);

      // Both responses should match
      expect(data1).toEqual(data2);

      await server.close();
    });

    it("should return balance with token details", async () => {
      const contractId =
        "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP";
      const server = await getDevServer();

      // First request should cache the static details
      const response1 = await fetch(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/token-details/${contractId}?network=TESTNET&pub_key=${pubKey}&should_fetch_balance=true`,
      );
      const data1 = await response1.json();
      expect(response1.status).toEqual(200);

      expect(data1.balance).toBe("1000000");

      await server.close();
    });

    it("rejects requests for invalid contract IDs", async () => {
      const invalidContractId = "invalid";
      const server = await getDevServer();
      const response = await fetch(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/token-details/${invalidContractId}?network=TESTNET&pub_key=${pubKey}`,
      );
      expect(response.status).toEqual(400);
      await server.close();
    });

    it("rejects requests without pub_key parameter", async () => {
      const contractId =
        "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP";
      const server = await getDevServer();
      const response = await fetch(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/token-details/${contractId}?network=TESTNET`,
      );
      expect(response.status).toEqual(400);
      await server.close();
    });
  });

  describe("/account-balances/:pubKey", () => {
    it("can fetch account balances for a pub key & contract IDs", async () => {
      const server = await getDevServer();
      const response = await fetch(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/account-balances/${pubKey}?contract_ids=CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP&network=TESTNET`,
      );
      expect(response.status).toEqual(200);
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
        }/api/v1/account-balances/${pubKey}`,
      );
      url.searchParams.append("network", "TESTNET");
      for (const id of contractIds) {
        url.searchParams.append("contract_ids", id);
      }
      const response = await fetch(url.href);
      expect(response.status).toEqual(200);
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
          params as any,
        )}`,
      );
      expect(response.status).toEqual(400);
      await server.close();
    });

    it("rejects requests for non strings that are not pub keys", async () => {
      const notPubkey = "newp";
      const server = await getDevServer();
      const response = await fetch(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/account-balances/${notPubkey}?contract_ids=CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP`,
      );
      expect(response.status).toEqual(400);
      await server.close();
    });

    it("rejects requests with bad contract IDs query param", async () => {
      const notContractId = "newp";
      const server = await getDevServer();
      const response = await fetch(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/account-balances/${pubKey}?contract_ids=${notContractId}`,
      );
      expect(response.status).toEqual(400);
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
        }/api/v1/account-balances/${pubKey}`,
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
        ].blockaidData.result_type,
      ).toEqual("Malicious");
      expect(
        data.balances[
          "TST:CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP"
        ].blockaidData.result_type,
      ).toEqual("Benign");
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
        }/api/v1/account-balances/${pubKey}`,
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
        ].blockaidData.result_type,
      ).toEqual("Benign");
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
        }/api/v1/account-balances/${pubKey}`,
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
        ].blockaidData.result_type,
      ).toEqual("Benign");
      await server.close();
    });
  });
  describe("/scan-asset-bulk", () => {
    it("can scan assets in bulk", async () => {
      const asset_ids = [
        "BLND-GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
        "FOO-CDP3XWJ4ZN222LKYBMWIY3GYXZYX3KA6WVNDS6V7WKXSYWLAEMYW7DTZ",
      ];
      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/scan-asset-bulk`,
      );
      url.searchParams.append("network", "PUBLIC");
      for (const id of asset_ids) {
        url.searchParams.append("asset_ids", id);
      }
      const response = await fetch(url.href);
      const data = await response.json();

      expect(response.status).toEqual(200);
      expect(
        data.data.results[
          "BLND-GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56"
        ],
      ).toEqual({
        result_type: "Malicious",
        malicious_score: 1,
      });
      expect(
        data.data.results[
          "FOO-CDP3XWJ4ZN222LKYBMWIY3GYXZYX3KA6WVNDS6V7WKXSYWLAEMYW7DTZ"
        ],
      ).toEqual({
        result_type: "Benign",
        malicious_score: 0,
      });
      await server.close();
    });
    it("does not scan assets when config is disabled", async () => {
      const asset_ids = [
        "BLND-GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
        "FOO-CDP3XWJ4ZN222LKYBMWIY3GYXZYX3KA6WVNDS6V7WKXSYWLAEMYW7DTZ",
      ];
      const server = await getDevServer({
        useBlockaidAssetScanning: false,
        useBlockaidDappScanning: false,
        useBlockaidTxScanning: false,
        useBlockaidAssetWarningReporting: true,
        useBlockaidTransactionWarningReporting: true,
      });
      const url = new URL(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/scan-asset-bulk`,
      );
      url.searchParams.append("network", "PUBLIC");
      for (const id of asset_ids) {
        url.searchParams.append("asset_ids", id);
      }
      const response = await fetch(url.href);
      const data = await response.json();

      expect(response.status).toEqual(200);
      expect(
        data.data.results[
          "BLND-GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56"
        ],
      ).toEqual({
        ...defaultBenignResponse,
      });
      expect(
        data.data.results[
          "FOO-CDP3XWJ4ZN222LKYBMWIY3GYXZYX3KA6WVNDS6V7WKXSYWLAEMYW7DTZ"
        ],
      ).toEqual({
        ...defaultBenignResponse,
      });
      await server.close();
    });
  });
  describe("/scan-asset", () => {
    it("can scan an asset", async () => {
      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/scan-asset`,
      );
      url.searchParams.append(
        "address",
        "BLND-GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
      );
      const response = await fetch(url.href);
      const data = await response.json();

      expect(response.status).toEqual(200);
      expect(data.data).toEqual({
        result_type: "Malicious",
        malicious_score: 1,
      });
      await server.close();
    });
    it("does not scan an asset when config is disabled", async () => {
      const server = await getDevServer({
        useBlockaidAssetScanning: false,
        useBlockaidDappScanning: false,
        useBlockaidTxScanning: false,
        useBlockaidAssetWarningReporting: true,
        useBlockaidTransactionWarningReporting: true,
      });
      const url = new URL(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/scan-asset`,
      );
      url.searchParams.append(
        "address",
        "BLND-GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
      );
      const response = await fetch(url.href);
      const data = await response.json();

      expect(response.status).toEqual(200);
      expect(data.data).toEqual({
        ...defaultBenignResponse,
        address:
          "BLND-GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
      });
      await server.close();
    });
  });
  describe.only("/scan-tx", () => {
    it("can scan a tx", async () => {
      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/scan-tx`,
      );
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tx_xdr: TEST_SOROBAN_TX,
          network: "PUBLIC",
          url: "https://example.com",
        }),
      };
      const response = await fetch(url.href, options);
      const data = await response.json();

      expect(response.status).toEqual(200);
      expect(data.data).toEqual({
        simulation: {
          status: "Success",
          assets_diffs: {},
          exposures: {},
          ownership_diffs: {},
          address_details: [],
          account_summary: [],
        },
        validation: {
          status: "Success",
          result_type: "Benign",
          description: "",
          reason: "",
          classification: "",
          features: [],
        },
        request_id: {
          "x-request-id": "1214",
        },
      });
      await server.close();
    });
    it("does not scan a tx when config is disabled", async () => {
      const server = await getDevServer({
        useBlockaidAssetScanning: false,
        useBlockaidDappScanning: false,
        useBlockaidTxScanning: false,
        useBlockaidAssetWarningReporting: true,
        useBlockaidTransactionWarningReporting: true,
      });
      const url = new URL(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/scan-tx`,
      );
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tx_xdr: TEST_SOROBAN_TX,
          network: "PUBLIC",
          url: "https://example.com",
        }),
      };
      const response = await fetch(url.href, options);
      const data = await response.json();

      expect(response.status).toEqual(200);
      expect(data).toEqual({
        data: null,
        error: ERROR.SCAN_TX_DISABLED,
      });
      await server.close();
    });
  });
  describe("/report-asset-warning", () => {
    it("can report an asset warning", async () => {
      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/report-asset-warning`,
      );
      url.searchParams.append(
        "address",
        "BLND-GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
      );
      url.searchParams.append("details", "foo");
      const response = await fetch(url.href);
      const data = await response.json();

      expect(response.status).toEqual(200);
      expect(data.data).toEqual(999);
      await server.close();
    });
    it("does not report an asset warning when config is disabled", async () => {
      const server = await getDevServer({
        useBlockaidAssetScanning: false,
        useBlockaidDappScanning: false,
        useBlockaidTxScanning: false,
        useBlockaidAssetWarningReporting: false,
        useBlockaidTransactionWarningReporting: true,
      });
      const url = new URL(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/report-asset-warning`,
      );
      url.searchParams.append(
        "address",
        "BLND-GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56",
      );
      url.searchParams.append("details", "foo");
      const response = await fetch(url.href);
      const data = await response.json();

      expect(response.status).toEqual(200);
      expect(data).toEqual({
        error: ERROR.REPORT_ASSET_DISABLED,
      });
      await server.close();
    });
  });
  describe("/report-transaction-warning", () => {
    it("can report a transaction warning", async () => {
      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/report-transaction-warning`,
      );
      url.searchParams.append("details", "foo");
      url.searchParams.append("request_id", "baz");
      url.searchParams.append("event", "should_be_malicious");
      const response = await fetch(url.href);
      const data = await response.json();

      expect(response.status).toEqual(200);
      expect(data.data).toEqual(999);
      await server.close();
    });
    it("does not report an trandaction warning when config is disabled", async () => {
      const server = await getDevServer({
        useBlockaidAssetScanning: false,
        useBlockaidDappScanning: false,
        useBlockaidTxScanning: false,
        useBlockaidAssetWarningReporting: true,
        useBlockaidTransactionWarningReporting: false,
      });
      const url = new URL(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/report-transaction-warning`,
      );
      url.searchParams.append("details", "foo");
      url.searchParams.append("request_id", "baz");
      url.searchParams.append("event", "should_be_malicious");
      const response = await fetch(url.href);
      const data = await response.json();

      expect(response.status).toEqual(200);
      expect(data).toEqual({
        error: ERROR.REPORT_TRANSACTION_DISABLED,
      });
      await server.close();
    });
  });
  describe("/token-prices", () => {
    it("accepts valid token strings in code:issuer format", async () => {
      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${(server?.server?.address() as any).port}/api/v1/token-prices`,
      );
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tokens: [
            // Test Alphanumeric 4 cases (1-4 chars)
            "USD:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            "BTC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            "a:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            "Ab1z:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            // Test Alphanumeric 12 cases (5-12 chars)
            "USDC123:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
            "abcde12345AB:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          ],
        }),
      };
      const response = await fetch(url.href, options);
      expect(response.status).toEqual(200);
      await server.close();
    });

    it("accepts XLM as a valid token", async () => {
      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${(server?.server?.address() as any).port}/api/v1/token-prices`,
      );
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tokens: ["XLM"],
        }),
      };
      const response = await fetch(url.href, options);
      expect(response.status).toEqual(200);
      await server.close();
    });

    it("accepts 'native' as a valid token", async () => {
      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${(server?.server?.address() as any).port}/api/v1/token-prices`,
      );
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tokens: ["native"],
        }),
      };
      const response = await fetch(url.href, options);
      expect(response.status).toEqual(200);
      await server.close();
    });

    it("rejects invalid token format", async () => {
      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${(server?.server?.address() as any).port}/api/v1/token-prices`,
      );
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tokens: ["invalid-token"], // Contains invalid character '-'
        }),
      };
      const response = await fetch(url.href, options);
      expect(response.status).toEqual(400);
      await server.close();
    });

    it("rejects tokens with invalid issuer public key", async () => {
      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${(server?.server?.address() as any).port}/api/v1/token-prices`,
      );
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tokens: ["USDC:invalid-public-key"],
        }),
      };
      const response = await fetch(url.href, options);
      expect(response.status).toEqual(400);
      await server.close();
    });

    it("rejects tokens with invalid asset code length", async () => {
      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${(server?.server?.address() as any).port}/api/v1/token-prices`,
      );
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tokens: [
            // Too long (> 12 chars)
            `TOOLONGASSETCDE:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`,
            // Empty code
            `:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`,
            // Invalid length (between 4 and 5 chars)
            `ABCD1:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`,
          ],
        }),
      };
      const response = await fetch(url.href, options);
      expect(response.status).toEqual(400);
      await server.close();
    });

    it("rejects tokens with invalid asset code characters", async () => {
      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${(server?.server?.address() as any).port}/api/v1/token-prices`,
      );
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tokens: [
            // Contains special character
            `USD$:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`,
            // Contains space
            `US D:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`,
            // Contains unicode
            `USD€:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`,
          ],
        }),
      };
      const response = await fetch(url.href, options);
      expect(response.status).toEqual(400);
      await server.close();
    });

    it("rejects empty token array", async () => {
      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${(server?.server?.address() as any).port}/api/v1/token-prices`,
      );
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tokens: [],
        }),
      };
      const response = await fetch(url.href, options);
      expect(response.status).toEqual(400);
      await server.close();
    });

    it("rejects arrays larger than 100 tokens", async () => {
      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${(server?.server?.address() as any).port}/api/v1/token-prices`,
      );

      // Create array of 101 valid tokens
      const tokens = Array(101).fill(
        "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
      );

      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tokens }),
      };
      const response = await fetch(url.href, options);
      expect(response.status).toEqual(400);
      await server.close();
    });

    it("rejects if any token in the array is invalid", async () => {
      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${(server?.server?.address() as any).port}/api/v1/token-prices`,
      );
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tokens: [
            "USD:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", // valid
            "invalid-token", // invalid format
            "XLM", // valid
          ],
        }),
      };
      const response = await fetch(url.href, options);
      expect(response.status).toEqual(400);
      await server.close();
    });
  });
  describe("/simulate-tx", () => {
    const simResponse = "simulated xdr";
    const preparedTransaction = "assembled tx xdr";

    beforeEach(() => {
      jest
        .spyOn(StellarHelpers, "getSdk")
        .mockImplementation((_networkPassphrase: Networks) => {
          return {
            TransactionBuilder: {
              fromXDR: (_xdr: string, _networkPassphrase: string) => "",
            },
            SorobanRpc: {
              Server: class Server {
                constructor(_url: string) {}
                simulateTransaction = (_tx: string) => simResponse;
              },
              assembleTransaction: (
                _tx: string,
                _simulateTransaction: StellarSdk.rpc.Api.SimulateTransactionResponse,
              ) => {
                return {
                  build: () => {
                    return {
                      toXDR: () => preparedTransaction,
                    };
                  },
                };
              },
            },
          } as any;
        });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("can simulate a transaction", async () => {
      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/simulate-tx`,
      );
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          xdr: TEST_SOROBAN_TX,
          network_url: getStellarRpcUrls(mockStellarRpcConfig).TESTNET,
          network_passphrase: Networks.TESTNET,
        }),
      };
      const response = await fetch(url.href, options);
      const data = await response.json();

      expect(response.status).toEqual(200);
      expect(data.simulationResponse).toEqual(simResponse);
      expect(data.preparedTransaction).toEqual(preparedTransaction);
      await server.close();
    });

    it("can fetch an onramp token", async () => {
      jest.spyOn(OnrampHelpers, "fetchOnrampSessionToken").mockReturnValueOnce(
        Promise.resolve({
          data: {
            token: "token",
          },
          error: null,
        }),
      );

      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/onramp/token`,
      );
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: "GFOO",
        }),
      };
      const response = await fetch(url.href, options);
      const resJson = await response.json();

      expect(response.status).toEqual(200);
      expect(resJson.data.token).toEqual("token");
      await server.close();
    });
    it("does not fetch a token without Coinbase config", async () => {
      jest.spyOn(OnrampHelpers, "fetchOnrampSessionToken").mockReturnValueOnce(
        Promise.resolve({
          data: {
            token: "token",
          },
          error: null,
        }),
      );

      const server = await getDevServer(undefined, {
        coinbaseApiKey: "",
        coinbaseApiSecret: "",
      });
      const url = new URL(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/onramp/token`,
      );
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: "GFOO",
        }),
      };
      const response = await fetch(url.href, options);
      const resJson = await response.json();

      expect(response.status).toEqual(400);
      expect(resJson.data).toEqual(undefined);
      expect(resJson.error).toEqual("Coinbase config not set");
      await server.close();
    });
    it("does not fetch a token if it is unable to generate the token", async () => {
      jest.spyOn(OnrampHelpers, "generateJWT").mockImplementation(() => {
        throw new Error("JWT generation failed");
      });

      const server = await getDevServer();
      const url = new URL(
        `http://localhost:${
          (server?.server?.address() as any).port
        }/api/v1/onramp/token`,
      );
      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: "GFOO",
        }),
      };
      const response = await fetch(url.href, options);
      const resJson = await response.json();

      expect(response.status).toEqual(400);
      expect(resJson.data).toEqual(undefined);
      expect(resJson.error).toEqual(
        "Unable to retrieve token: Error: JWT generation failed",
      );
      await server.close();
    });
  });
});
