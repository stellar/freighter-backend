import * as StellarSdk from "stellar-sdk";
import "@blockaid/client";
import {
  getDevServer,
  queryMockResponse,
  pubKey,
  register,
  TEST_SOROBAN_TX,
} from "../helper/test-helper";
import { transformAccountHistory } from "../service/mercury/helpers/transformers";
import { query } from "../service/mercury/queries";
import { defaultBenignResponse } from "../service/blockaid/helpers/addScanResults";
import { Networks } from "stellar-sdk-next";
import { SOROBAN_RPC_URLS } from "../helper/soroban-rpc";
import { ERROR } from "../helper/error";
import * as StellarHelpers from "../helper/stellar";

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
      register.clear();
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
        }/api/v1/account-balances/${pubKey}?contract_ids=CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP&network=TESTNET`,
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
        }/api/v1/account-balances/${pubKey}`,
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
          params as any,
        )}`,
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
        }/api/v1/account-balances/${notPubkey}?contract_ids=CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP`,
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
        }/api/v1/account-balances/${pubKey}?contract_ids=${notContractId}`,
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
      register.clear();
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
      register.clear();
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
      register.clear();
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
      register.clear();
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
      register.clear();
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
      register.clear();
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
      register.clear();
      await server.close();
    });
  });
  describe.only("/report-transaction-warning", () => {
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
      register.clear();
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
      register.clear();
      await server.close();
    });
  });
  describe("/simulate-tx", () => {
    const simResponse = "simulated xdr";
    const preparedTransaction = "assembled tx xdr";
    let spy: any;

    beforeEach(() => {
      spy = jest
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
      spy.mockRestore(); // Restore original implementation for the other tests
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
          network_url: SOROBAN_RPC_URLS.TESTNET,
          network_passphrase: Networks.TESTNET,
        }),
      };
      const response = await fetch(url.href, options);
      const data = await response.json();

      expect(response.status).toEqual(200);
      expect(data.simulationResponse).toEqual(simResponse);
      expect(data.preparedTransaction).toEqual(preparedTransaction);
      register.clear();
      await server.close();
    });
  });
});
