import { Client, fetchExchange } from "@urql/core";
import pino from "pino";

import { mutation, query } from "../service/mercury/queries";
import { MercuryClient } from "../service/mercury";

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

const mercurySession = {
  token: "mercury-token",
  backend: "mercury-url",
  email: "user-email",
  password: "user-password",
  userId: "1",
};

const pubKey = "GDUBMXMABE7UOZSGYJ5ONE7UYAEHKK3JOX7HZQGNZ7NYTZPPP4AJ2GQJ";
const tokenBalanceLedgerKey =
  "AAAAEAAAAAEAAAABAAAAEQAAAAEAAAACAAAADwAAAAdiYWxhbmNlAAAAAA4AAAAHQmFsYW5jZQAAAAAPAAAAB2FkZHJlc3MAAAAADgAAADhHRFVCTVhNQUJFN1VPWlNHWUo1T05FN1VZQUVIS0szSk9YN0haUUdOWjdOWVRaUFBQNEFKMkdRSg==";

const queryMockResponse = {
  [mutation.authenticate]: {
    authenticate: {
      jwtToken: "mercury-token",
    },
  },
  [mutation.newAccountSubscription]: {
    createFullAccountSubscription: {
      fullAccountSubscription: {
        publickey: pubKey,
        id: 28,
      },
    },
  },
  "query.getAccountBalances": {
    edges: [
      {
        node: {
          contractId: "contract-id-1",
          keyXdr: tokenBalanceLedgerKey,
          valueXdr: "value-xdr",
          ledgerTimestamp: "timestamp",
          ledger: "1",
          entryDurability: "persistent",
        },
      },
      {
        node: {
          contractId: "contract-id-2",
          keyXdr: tokenBalanceLedgerKey,
          valueXdr: "value-xdr",
          ledgerTimestamp: "timestamp",
          ledger: "1",
          entryDurability: "persistent",
        },
      },
    ],
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
                "GCGORBD5DB4JDIKVIA536CJE3EWMWZ6KBUBWZWRQM7Y3NHFRCLOKYVAL",
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

jest.spyOn(client, "query").mockImplementation((_query: any): any => {
  switch (_query) {
    case mutation.authenticate: {
      return Promise.resolve({
        data: queryMockResponse[mutation.authenticate],
        error: null,
      });
    }
    case mutation.newAccountSubscription: {
      return Promise.resolve({
        data: queryMockResponse[mutation.newAccountSubscription],
        error: null,
      });
    }
    case query.getAccountHistory: {
      return Promise.resolve({
        data: queryMockResponse[query.getAccountHistory],
        error: null,
      });
    }
    case query.getAccountBalances(tokenBalanceLedgerKey, [
      "contract-id-1",
      "contract-id-2",
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

const mockMercuryClient = new MercuryClient(mercurySession, client, testLogger);

export { pubKey, mockMercuryClient, queryMockResponse };
