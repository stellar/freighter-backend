import { Client, fetchExchange } from "@urql/core";
import pino from "pino";
import { nativeToScVal } from "stellar-sdk";
import Prometheus from "prom-client";

import { mutation, query } from "../service/mercury/queries";
import { MercuryClient } from "../service/mercury";
import { initApiServer } from "../route";
import { NetworkNames } from "./validate";
import { hasIndexerSupport } from "./mercury";

export const base64regex =
  /^([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/;

export const testLogger = pino({
  name: "test-logger",
  serializers: {
    req: pino.stdSerializers.req,
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
});

function renewClientMaker(network: NetworkNames) {
  if (!hasIndexerSupport(network)) {
    throw new Error(`network not currently supported: ${network}`);
  }

  const client = new Client({
    url: `::1:5000/graphql`,
    exchanges: [fetchExchange],
  });

  jest.spyOn(client, "mutation").mockImplementation((_mutation: any): any => {
    switch (_mutation) {
      case mutation.authenticate: {
        return Promise.resolve({
          data: queryMockResponse[mutation.authenticate],
          error: null,
        });
      }
      default:
        throw new Error("unknown mutation in mock");
    }
  });

  return client;
}

function backendClientMaker(network: NetworkNames) {
  if (!hasIndexerSupport(network)) {
    throw new Error(`network not currently supported: ${network}`);
  }

  const client = new Client({
    url: `::1:5000/graphql`,
    exchanges: [fetchExchange],
    fetchOptions: () => {
      return {
        headers: { authorization: "Bearer JWT" },
      };
    },
  });

  jest.spyOn(client, "query").mockImplementation((_query: any): any => {
    switch (_query) {
      case query.getAccountHistory: {
        return Promise.resolve({
          data: queryMockResponse[query.getAccountHistory],
          error: null,
        });
      }
      case query.getAccountBalances(pubKey, tokenBalanceLedgerKey, [
        "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
      ]): {
        return Promise.resolve({
          data: queryMockResponse["query.getAccountBalances"],
          error: null,
        });
      }
      case query.getAccountBalances(pubKey, tokenBalanceLedgerKey, [
        "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
        "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
      ]): {
        return Promise.resolve({
          data: queryMockResponse["query.getAccountBalances"],
          error: null,
        });
      }
      case query.getAccountSubForPubKey(pubKey): {
        return Promise.resolve({
          data: {
            allFullAccountSubscriptionsList: [{ publickey: pubKey }],
          },
          error: null,
        });
      }
      case query.getTokenBalanceSub(
        "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
        tokenBalanceLedgerKey
      ): {
        return Promise.resolve({
          data: {
            allEntryUpdates: {
              nodes: [
                {
                  contractId:
                    "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
                },
              ],
            },
          },
          error: null,
        });
      }
      case query.getTokenBalanceSub(
        "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
        tokenBalanceLedgerKey
      ): {
        return Promise.resolve({
          data: {
            allEntryUpdates: {
              nodes: [
                {
                  contractId:
                    "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
                },
              ],
            },
          },
          error: null,
        });
      }
      case query.getCurrentDataAccountBalances(
        pubKey,
        tokenBalanceLedgerKey,
        []
      ): {
        return Promise.resolve({
          data: queryMockResponse["query.getAccountBalancesCurrentData"],
          error: null,
        });
      }
      case query.getCurrentDataAccountBalances(pubKey, tokenBalanceLedgerKey, [
        "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
      ]): {
        return Promise.resolve({
          data: queryMockResponse[
            "query.getAccountBalancesCurrentDataWithFirstContracts"
          ],
          error: null,
        });
      }
      case query.getCurrentDataAccountBalances(pubKey, tokenBalanceLedgerKey, [
        "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
        "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
      ]): {
        return Promise.resolve({
          data: queryMockResponse[
            "query.getAccountBalancesCurrentDataWithBothContracts"
          ],
          error: null,
        });
      }
      case query.getAccountObject(pubKey): {
        return Promise.resolve({
          data: queryMockResponse["query.getAccountObject"],
          error: null,
        });
      }
      default:
        throw new Error("unknown query in mock");
    }
  });

  jest.spyOn(client, "mutation").mockImplementation((_mutation: any): any => {
    switch (_mutation) {
      default:
        throw new Error("unknown mutation in mock");
    }
  });

  return client;
}

const backends = {
  TESTNET: `::1:5000/graphql`,
  PUBLIC: `::1:5000/graphql`,
};

const mercurySession = {
  token: "mercury-token",
  renewClientMaker,
  backendClientMaker,
  currentDataClientMaker: backendClientMaker,
  backends,
  email: "user-email",
  password: "user-password",
  userId: "1",
};

const valueXdr = nativeToScVal(1).toXDR();
const pubKey = "GCGORBD5DB4JDIKVIA536CJE3EWMWZ6KBUBWZWRQM7Y3NHFRCLOKYVAL";
const contractDataEntryValXdr =
  "AAA5zAAAAAYAAAAAAAAAAY6oGxM6ldCYnaiGZ39Qfe7OU9/hMzrwkVF8OBHpqKMTAAAAEAAAAAEAAAACAAAADwAAAAdCYWxhbmNlAAAAABIAAAAAAAAAAIzohH0YeJGhVUA7vwkk2SzLZ8oNA2zaMGfxtpyxEtysAAAAAQAAAAoAAAAAAAAAAAAAAAAAAAAKAAAAAA==";
const tokenBalanceLedgerKey =
  "AAAAEAAAAAEAAAACAAAADwAAAAdCYWxhbmNlAAAAABIAAAAAAAAAAIzohH0YeJGhVUA7vwkk2SzLZ8oNA2zaMGfxtpyxEtys";

const queryMockResponse = {
  [mutation.authenticate]: {
    authenticate: {
      jwtToken: "mercury-token",
    },
  },
  "query.getAccountBalancesCurrentData": {
    trustlinesByPublicKey: [
      {
        balance: 100019646386,
        asset: "AAAAAUJMTkQAAAAAJgXM07IdPwaDCLLNw46HAu0Jy3Az9GJKesWnsk57zF4=",
        limit: 1,
        accountId: pubKey,
      },
    ],
  },
  "query.getAccountBalancesCurrentDataWithFirstContracts": {
    trustlinesByPublicKey: [
      {
        balance: 100019646386,
        asset: "AAAAAUJMTkQAAAAAJgXM07IdPwaDCLLNw46HAu0Jy3Az9GJKesWnsk57zF4=",
        limit: 1,
        accountId: pubKey,
      },
    ],
    CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP: [
      {
        contractId: "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
        keyXdr:
          "AAAAEAAAAAEAAAACAAAADwAAAAdCYWxhbmNlAAAAABIAAAAAAAAAAIzohH0YeJGhVUA7vwkk2SzLZ8oNA2zaMGfxtpyxEtys",
        valXdr: contractDataEntryValXdr,
        durability: 1,
      },
    ],
  },
  "query.getAccountBalancesCurrentDataWithBothContracts": {
    trustlinesByPublicKey: [
      {
        balance: 100019646386,
        asset: "AAAAAUJMTkQAAAAAJgXM07IdPwaDCLLNw46HAu0Jy3Az9GJKesWnsk57zF4=",
        limit: 1,
        accountId: pubKey,
      },
    ],
    CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP: [
      {
        contractId: "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
        keyXdr:
          "AAAAEAAAAAEAAAACAAAADwAAAAdCYWxhbmNlAAAAABIAAAAAAAAAAIzohH0YeJGhVUA7vwkk2SzLZ8oNA2zaMGfxtpyxEtys",
        valXdr: contractDataEntryValXdr,
        durability: 1,
      },
    ],
    CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG: [
      {
        contractId: "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
        keyXdr:
          "AAAAEAAAAAEAAAACAAAADwAAAAdCYWxhbmNlAAAAABIAAAAAAAAAAIzohH0YeJGhVUA7vwkk2SzLZ8oNA2zaMGfxtpyxEtys",
        valXdr: contractDataEntryValXdr,
        durability: 1,
      },
    ],
  },
  "query.getAccountObject": {
    accountObjectByPublicKey: {
      nodes: [
        {
          accountByAccount: {
            publickey: pubKey,
          },
          nativeBalance: "10",
          numSubEntries: "1",
          numSponsored: "1",
          numSponsoring: "1",
          sellingLiabilities: "1",
        },
      ],
    },
  },
  "query.getAccountBalances": {
    CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP: {
      nodes: [
        {
          contractId:
            "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
          keyXdr: tokenBalanceLedgerKey,
          valueXdr,
          ledgerTimestamp: "timestamp",
          ledger: "1",
          entryDurability: "persistent",
        },
      ],
    },
    CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG: {
      nodes: [
        {
          contractId:
            "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
          keyXdr: tokenBalanceLedgerKey,
          valueXdr,
          ledgerTimestamp: "timestamp",
          ledger: "1",
          entryDurability: "persistent",
        },
      ],
    },
    balanceByPublicKey: {
      nodes: [],
    },
    accountObjectByPublicKey: {
      nodes: [
        {
          accountByAccount: {
            publickey: pubKey,
          },
          nativeBalance: "10",
          numSubEntries: "1",
          numSponsored: "1",
          numSponsoring: "1",
          sellingLiabilities: "1",
        },
      ],
    },
  },
  [query.getAccountHistory]: {
    invokeHostFnByPublicKey: {
      edges: [],
    },
    createAccountByPublicKey: {
      edges: [],
    },
    createAccountToPublicKey: {
      edges: [],
    },
    paymentsByPublicKey: {
      edges: [],
    },
    paymentsToPublicKey: {
      edges: [
        {
          node: {
            amount: "50000000",
            assetNative: true,
            accountBySource: {
              publickey:
                "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
            },
            assetByAsset: {
              code: btoa("DT"),
              issuer:
                "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
            },
            accountByDestination: {
              publickey: pubKey,
            },
            id: "12235",
            txInfoByTx: {
              opCount: 1,
              fee: "1000",
              ledgerByLedger: {
                closeTime: 1703024113,
              },
            },
          },
        },
      ],
    },
    pathPaymentsStrictSendByPublicKey: {
      nodes: [],
    },
    pathPaymentsStrictSendToPublicKey: {
      nodes: [],
    },
    pathPaymentsStrictReceiveByPublicKey: {
      nodes: [],
    },
    pathPaymentsStrictReceiveToPublicKey: {
      nodes: [],
    },
    manageBuyOfferByPublicKey: {
      edges: [],
    },
    manageSellOfferByPublicKey: {
      edges: [],
    },
    createPassiveSellOfferByPublicKey: {
      nodes: [],
    },
    changeTrustByPublicKey: {
      nodes: [],
    },
    accountMergeByPublicKey: {
      edges: [],
    },
    bumpSequenceByPublicKey: {
      edges: [],
    },
    claimClaimableBalanceByPublicKey: {
      edges: [],
    },
    createClaimableBalanceByPublicKey: {
      edges: [],
    },
    allowTrustByPublicKey: {
      edges: [],
    },
    manageDataByPublicKey: {
      edges: [],
    },
    beginSponsoringFutureReservesByPublicKey: {
      edges: [],
    },
    endSponsoringFutureReservesByPublicKey: {
      edges: [],
    },
    revokeSponsorshipByPublicKey: {
      edges: [],
    },
    clawbackByPublicKey: {
      edges: [],
    },
    setTrustLineFlagsByPublicKey: {
      edges: [],
    },
    liquidityPoolDepositByPublicKey: {
      edges: [],
    },
    liquidityPoolWithdrawByPublicKey: {
      edges: [],
    },
    createClaimableBalanceToPublicKey: {
      edges: [],
    },
  },
};

export const register = new Prometheus.Registry();

const mockMercuryClient = new MercuryClient(
  mercurySession,
  testLogger,
  register
);

jest
  .spyOn(mockMercuryClient, "tokenDetails")
  .mockImplementation(
    (..._args: Parameters<MercuryClient["tokenDetails"]>): any => {
      return {
        name: "Test Contract",
        decimals: 7,
        symbol: "TST",
      };
    }
  );
async function getDevServer() {
  const server = await initApiServer(
    mockMercuryClient,
    testLogger,
    true,
    true,
    register
  );

  await server.listen();
  return server;
}
export {
  pubKey,
  mockMercuryClient,
  queryMockResponse,
  getDevServer,
  tokenBalanceLedgerKey,
};
