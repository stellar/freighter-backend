import * as dotEnv from 'dotenv'
import { expand } from 'dotenv-expand'

import { logger } from './logger'
import { buildConfig } from './config'

import yargs from 'yargs'

interface CliArgs {
  env: string
  port: number
}

async function main() {
  const _config = dotEnv.config({ path: '.env' })
  expand(_config)

  const config = _config.parsed || {}
  // @ts-ignore
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

  // @ts-ignore
  const env = argv.env || 'development'
  // @ts-ignore
  const port = argv.port || 3002

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