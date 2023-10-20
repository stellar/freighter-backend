import { Client, fetchExchange } from '@urql/core'
import pino from 'pino'

import { mutation } from './queries'
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

jest.spyOn(client, 'query').mockImplementation((query: any): any => {
  switch (query) {
    case mutation.authenticate: {
      return Promise.resolve({
        data: {
          authenticate: {
            jwtToken: queryMockResponse[mutation.authenticate]
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
})