import { Client, fetchExchange } from "@urql/core";
import pino from "pino";

import { mutation, query } from "../service/mercury/queries";
import { MercuryClient } from "../service/mercury";
import { initApiServer } from "../route";

const testLogger = pino({
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

const client = new Client({
  url: `::1:5000/graphql`,
  exchanges: [fetchExchange],
  fetchOptions: () => {
    return {
      headers: { authorization: "Bearer JWT" },
    };
  },
});

const renewClient = new Client({
  url: `::1:5000/graphql`,
  exchanges: [fetchExchange],
});

const mercurySession = {
  token: "mercury-token",
  backend: "mercury-url",
  email: "user-email",
  password: "user-password",
  userId: "1",
};

const pubKey = "GCGORBD5DB4JDIKVIA536CJE3EWMWZ6KBUBWZWRQM7Y3NHFRCLOKYVAL";
const tokenBalanceLedgerKey =
  "AAAAEAAAAAEAAAACAAAADwAAAAdCYWxhbmNlAAAAABIAAAAAAAAAAIzohH0YeJGhVUA7vwkk2SzLZ8oNA2zaMGfxtpyxEtys";

const queryMockResponse = {
  [mutation.authenticate]: {
    authenticate: {
      jwtToken: "mercury-token",
    },
  },
  "query.getAccountBalances": {
    entryUpdateByContractIdAndKey: {
      nodes: [
        {
          contractId:
            "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
          keyXdr: tokenBalanceLedgerKey,
          valueXdr: "value-xdr",
          ledgerTimestamp: "timestamp",
          ledger: "1",
          entryDurability: "persistent",
        },
        {
          contractId:
            "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
          keyXdr: tokenBalanceLedgerKey,
          valueXdr: "value-xdr",
          ledgerTimestamp: "timestamp",
          ledger: "1",
          entryDurability: "persistent",
        },
      ],
    },
  },
  [query.getAccountHistory]: {
    eventByContractId: {
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
            accountByDestination: {
              publickey: pubKey,
            },
          },
        },
      ],
    },
  },
};

jest
  .spyOn(renewClient, "mutation")
  .mockImplementation((_mutation: any): any => {
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

jest.spyOn(client, "query").mockImplementation((_query: any): any => {
  switch (_query) {
    case query.getAccountHistory: {
      return Promise.resolve({
        data: queryMockResponse[query.getAccountHistory],
        error: null,
      });
    }
    case query.getAccountBalances(tokenBalanceLedgerKey, [
      "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
    ]): {
      return Promise.resolve({
        data: queryMockResponse["query.getAccountBalances"],
        error: null,
      });
    }
    case query.getAccountBalances(tokenBalanceLedgerKey, [
      "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
      "CBGTG7XFRY3L6OKAUTR6KGDKUXUQBX3YDJ3QFDYTGVMOM7VV4O7NCODG",
    ]): {
      return Promise.resolve({
        data: queryMockResponse["query.getAccountBalances"],
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

const mockMercuryClient = new MercuryClient(
  "http://example.com/graphql",
  mercurySession,
  client,
  renewClient,
  testLogger
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
  const server = initApiServer(mockMercuryClient, testLogger);
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
