import { Client, fetchExchange } from '@urql/core'
import pino from 'pino'

import { mutation, query } from './queries'
import { MercuryClient } from '.'

const testLogger = pino({
  name: 'test-logger',
  serializers: {
    req: pino.stdSerializers.req,
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true
    }
  },
})

const client = new Client({
  url: `::1:5000/graphql`,
  exchanges: [fetchExchange],
  fetchOptions: () => {
    return {
      headers: { authorization: 'Bearer JWT' },
    };
  }
})
const mercurySession = {
  token: 'mercury-token',
  baseUrl: 'mercury-url',
  email: 'user-email',
  password: 'user-password'
}

const queryMockResponse = {
  [mutation.authenticate]: 'mercury-token'
}

jest.spyOn(client, 'query').mockImplementation((_query: any): any => {
  switch (_query) {
    case mutation.authenticate: {
      return Promise.resolve({
        data: {
          authenticate: {
            jwtToken: queryMockResponse[mutation.authenticate]
          }
        }
      })
    }
    case query.getAccountHistory: {
      return Promise.resolve({
        data: {
          "eventByContractId": {
            "edges": []
          },
          "createAccountByPublicKey": {
            "edges": []
          },
          "createAccountToPublicKey": {
            "edges": []
          },
          "paymentsByPublicKey": {
            "edges": []
          },
          "paymentsToPublicKey": {
            "edges": [
              {
                "node": {
                  "amount": "50000000",
                  "assetNative": true,
                  "accountBySource": {
                    "publickey": "GCGORBD5DB4JDIKVIA536CJE3EWMWZ6KBUBWZWRQM7Y3NHFRCLOKYVAL"
                  },
                  "accountByDestination": {
                    "publickey": "GDUBMXMABE7UOZSGYJ5ONE7UYAEHKK3JOX7HZQGNZ7NYTZPPP4AJ2GQJ"
                  }
                }
              }
            ]
          }
        }
      })
    }
    default:
      throw new Error('unknown query in mock')
  }
})

const mockClient = new MercuryClient(mercurySession, client, testLogger)

describe('Mercury Service', () => {
  it('can renew a token', async () => {
    const token = await mockClient.renewMercuryToken()
    const expected = {'data': {'authenticate': {'jwtToken': queryMockResponse[mutation.authenticate]}}, 'error': null}
    expect(token).toEqual(expected)
    expect(mockClient.mercurySession.token).toEqual(queryMockResponse[mutation.authenticate])
  })

  it('can fetch account history with a payment-to in history', async () => {
    const pubKey = 'GDUBMXMABE7UOZSGYJ5ONE7UYAEHKK3JOX7HZQGNZ7NYTZPPP4AJ2GQJ'
    const history = await mockClient.getAccountHistory(pubKey)
    const paymentsToPublicKey = history.data?.data.paymentsToPublicKey.edges[0].node
    expect(paymentsToPublicKey.accountByDestination.publickey).toEqual(pubKey)
    expect(paymentsToPublicKey.amount).toBe("50000000")
  })
})