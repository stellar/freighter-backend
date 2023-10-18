import pino from 'pino'

const logger = pino({
  name: 'mercury-client-logger',
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

export {
  logger
}