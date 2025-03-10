import { Client, fetchExchange } from "@urql/core";
import pino from "pino";
import { nativeToScVal } from "stellar-sdk";
import Prometheus from "prom-client";
import Blockaid from "@blockaid/client";

import { mutation, query } from "../service/mercury/queries";
import { MercuryClient } from "../service/mercury";
import { initApiServer } from "../route";
import { NetworkNames } from "./validate";
import { hasIndexerSupport } from "./mercury";
import { BlockAidService } from "../service/blockaid";
import { PriceClient } from "../service/prices";

export const TEST_SOROBAN_TX =
  "AAAAAgAAAACM6IR9GHiRoVVAO78JJNksy2fKDQNs2jBn8bacsRLcrDucaFsAAAWIAAAAMQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAGAAAAAAAAAABHkEVdJ+UfDnWpBr/qF582IEoDQ0iW0WPzO9CEUdvvh8AAAAIdHJhbnNmZXIAAAADAAAAEgAAAAAAAAAAjOiEfRh4kaFVQDu/CSTZLMtnyg0DbNowZ/G2nLES3KwAAAASAAAAAAAAAADoFl2ACT9HZkbCeuaT9MAIdStpdf58wM3P24nl738AnQAAAAoAAAAAAAAAAAAAAAAAAAAFAAAAAQAAAAAAAAAAAAAAAR5BFXSflHw51qQa/6hefNiBKA0NIltFj8zvQhFHb74fAAAACHRyYW5zZmVyAAAAAwAAABIAAAAAAAAAAIzohH0YeJGhVUA7vwkk2SzLZ8oNA2zaMGfxtpyxEtysAAAAEgAAAAAAAAAA6BZdgAk/R2ZGwnrmk/TACHUraXX+fMDNz9uJ5e9/AJ0AAAAKAAAAAAAAAAAAAAAAAAAABQAAAAAAAAABAAAAAAAAAAIAAAAGAAAAAR5BFXSflHw51qQa/6hefNiBKA0NIltFj8zvQhFHb74fAAAAFAAAAAEAAAAHa35L+/RxV6EuJOVk78H5rCN+eubXBWtsKrRxeLnnpRAAAAACAAAABgAAAAEeQRV0n5R8OdakGv+oXnzYgSgNDSJbRY/M70IRR2++HwAAABAAAAABAAAAAgAAAA8AAAAHQmFsYW5jZQAAAAASAAAAAAAAAACM6IR9GHiRoVVAO78JJNksy2fKDQNs2jBn8bacsRLcrAAAAAEAAAAGAAAAAR5BFXSflHw51qQa/6hefNiBKA0NIltFj8zvQhFHb74fAAAAEAAAAAEAAAACAAAADwAAAAdCYWxhbmNlAAAAABIAAAAAAAAAAOgWXYAJP0dmRsJ65pP0wAh1K2l1/nzAzc/bieXvfwCdAAAAAQBkcwsAACBwAAABKAAAAAAAAB1kAAAAAA==";

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
        tokenBalanceLedgerKey,
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
        tokenBalanceLedgerKey,
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
      case query.getTokenBalanceSub(
        "CDP3XWJ4ZN222LKYBMWIY3GYXZYX3KA6WVNDS6V7WKXSYWLAEMYW7DTZ",
        tokenBalanceLedgerKey,
      ): {
        return Promise.resolve({
          data: {
            allEntryUpdates: {
              nodes: [
                {
                  contractId:
                    "CDP3XWJ4ZN222LKYBMWIY3GYXZYX3KA6WVNDS6V7WKXSYWLAEMYW7DTZ",
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
        [],
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
      case query.getCurrentDataAccountBalances(pubKey, tokenBalanceLedgerKey, [
        "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
        "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
        "CDP3XWJ4ZN222LKYBMWIY3GYXZYX3KA6WVNDS6V7WKXSYWLAEMYW7DTZ",
      ]): {
        return Promise.resolve({
          data: queryMockResponse[
            "query.getAccountBalancesCurrentDataWithThreeContracts"
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
  renewClientMaker,
  backendClientMaker,
  currentDataClientMaker: backendClientMaker,
  backends,
  credentials: {
    TESTNET: {
      email: "user-email",
      password: "user-password",
    },
    PUBLIC: {
      email: "user-email",
      password: "user-password",
    },
  },
};

const valueXdr = nativeToScVal(1).toXDR();
const pubKey = "GCGORBD5DB4JDIKVIA536CJE3EWMWZ6KBUBWZWRQM7Y3NHFRCLOKYVAL";
export const contractDataEntryValXdr =
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
    accountByPublicKey: {
      accountId: pubKey,
      nativeBalance: "10",
      numSubEntries: "1",
      numSponsored: "1",
      numSponsoring: "1",
      sellingLiabilities: "1000000",
    },
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
    accountByPublicKey: {
      accountId: pubKey,
      nativeBalance: "10",
      numSubEntries: "1",
      numSponsored: "1",
      numSponsoring: "1",
      sellingLiabilities: "1000000",
    },
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
    accountByPublicKey: {
      accountId: pubKey,
      nativeBalance: "10",
      numSubEntries: "1",
      numSponsored: "1",
      numSponsoring: "1",
      sellingLiabilities: "1000000",
    },
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
  "query.getAccountBalancesCurrentDataWithThreeContracts": {
    trustlinesByPublicKey: [
      {
        balance: 100019646386,
        asset: "AAAAAUJMTkQAAAAAJgXM07IdPwaDCLLNw46HAu0Jy3Az9GJKesWnsk57zF4=",
        limit: 1,
        accountId: pubKey,
      },
    ],
    accountByPublicKey: {
      accountId: pubKey,
      nativeBalance: "10",
      numSubEntries: "1",
      numSponsored: "1",
      numSponsoring: "1",
      sellingLiabilities: "1000000",
    },
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
    CDP3XWJ4ZN222LKYBMWIY3GYXZYX3KA6WVNDS6V7WKXSYWLAEMYW7DTZ: [
      {
        contractId: "CDP3XWJ4ZN222LKYBMWIY3GYXZYX3KA6WVNDS6V7WKXSYWLAEMYW7DTZ",
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
    CDP3XWJ4ZN222LKYBMWIY3GYXZYX3KA6WVNDS6V7WKXSYWLAEMYW7DTZ: {
      nodes: [
        {
          contractId:
            "CDP3XWJ4ZN222LKYBMWIY3GYXZYX3KA6WVNDS6V7WKXSYWLAEMYW7DTZ",
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
    paymentsOfPublicKey: {
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
    pathPaymentsStrictSendOfPublicKey: {
      nodes: [],
    },
    pathPaymentsStrictReceiveOfPublicKey: {
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
    setOptionsByPublicKey: {
      edges: [],
    },
  },
};

export const register = new Prometheus.Registry();

const mercuryErrorCounter = new Prometheus.Counter({
  name: "freighter_backend_mercury_error_count",
  help: "Count of errors returned from Mercury",
  labelNames: ["endpoint"],
  registers: [register],
});

const rpcErrorCounter = new Prometheus.Counter({
  name: "freighter_backend_rpc_error_count",
  help: "Count of errors returned from Horizon or Soroban RPCs",
  labelNames: ["rpc"],
  registers: [register],
});

const criticalError = new Prometheus.Counter({
  name: "freighter_backend_critical_error_count",
  help: "Count of errors that need manual operator intervention or investigation",
  labelNames: ["message"],
  registers: [register],
});
const mockPriceClient = new PriceClient(testLogger);
const mockMercuryClient = new MercuryClient(
  mercurySession,
  testLogger,
  register,
  {
    mercuryErrorCounter,
    rpcErrorCounter,
    criticalError,
  },
);
jest.mock("@blockaid/client", () => {
  return class Blockaid {};
});
const blockAidClient = new Blockaid();
const blockAidService = new BlockAidService(
  blockAidClient,
  testLogger,
  register,
);

jest
  .spyOn(mockMercuryClient, "tokenDetails")
  .mockImplementation(
    (
      _pubKey: string,
      _contractId: string,
      _network: NetworkNames,
      shouldFetchBalance?: boolean,
    ): any => {
      const baseResponse = {
        name: "Test Contract",
        decimals: "7",
        symbol: "TST",
      };

      if (shouldFetchBalance) {
        return {
          ...baseResponse,
          balance: "1000000",
        };
      }

      return baseResponse;
    },
  );
async function getDevServer(
  blockaidConfig = {
    useBlockaidAssetScanning: true,
    useBlockaidDappScanning: true,
    useBlockaidTxScanning: true,
    useBlockaidAssetWarningReporting: true,
    useBlockaidTransactionWarningReporting: true,
  },
) {
  const server = await initApiServer(
    mockMercuryClient,
    blockAidService,
    mockPriceClient,
    testLogger,
    true,
    true,
    register,
    "development",
    blockaidConfig,
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
