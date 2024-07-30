import pino from "pino";

const urlToRedacted = (url: string) => {
  if (url.includes("/api/v1/account-history")) {
    return "/api/v1/account-history";
  }
  if (url.includes("/api/v1/account-balances")) {
    return "/api/v1/account-balances";
  }
  return url;
};

const logger = pino({
  name: "freighter-logger",
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
  redact: {
    paths: [
      "req.remoteAddress",
      "req.remotePort",
      "req.headers.host",
      "req.headers['user-agent']",
      "req.url",
      "req.params.pubKey",
      "req.query.pub_key",
    ],
    censor: (value: string, path: string[]) => {
      const _path = path.join(".");
      if (_path === "req.url") {
        return urlToRedacted(value);
      }
      return "Redacted";
    },
  },
});

export { logger };
