import * as dotEnv from 'dotenv'
import { expand } from 'dotenv-expand'
import yargs from 'yargs'
import { Client, fetchExchange } from '@urql/core'

import { logger } from './logger'
import { buildConfig } from './config'
import { MercuryClient } from './service/mercury'
import { initApiServer } from './route'

interface CliArgs {
  env: string
  port: number
}

async function main() {
  const _config = dotEnv.config({ path: '.env' })
  expand(_config)

  const config = _config.parsed || {}
  const conf = buildConfig(config)

  const argv = yargs(process.argv).options({
    env: {
      alias: 'e',
      type: 'string',
      description: 'env - production or development'
    },
    port: {
      alias: 'p',
      type: 'number',
      description: 'port for server'
    },
  }).argv as CliArgs

  const env = argv.env || 'development'
  const port = argv.port || 3002

  const client = new Client({
    url: `${conf.mercuryUrl}:5000/graphql`,
    exchanges: [fetchExchange],
    fetchOptions: () => {
      return {
        headers: { authorization: `Bearer ${conf.mercuryKey}` },
      };
    }
  })
  const mercurySession = {
    token: conf.mercuryKey,
    baseUrl: conf.mercuryUrl,
    email: conf.mercuryEmail,
    password: conf.mercuryPassword
  }
  const mercuryClient = new MercuryClient(mercurySession, client, logger)
  const server = initApiServer(mercuryClient)

  try {
    await server.listen({ port })
    logger.info(`Running in ${env} mode`)
  } catch (err) {
    server.log.error(err)
    process.exit(1)
  }

  process.on('SIGTERM', () => {
    process.exit(0)
  })
  
  process.on('SIGINT', function() {
    process.exit(0)
  })
}

process.on('uncaughtException', function (err) {
  logger.error(err)
  process.kill(process.pid, 'SIGTERM')
})

process.on('unhandledRejection', function (reason: string) {
  logger.error(reason)
})

main().catch((e) => {
  logger.error(e)
  process.exit(1)
})