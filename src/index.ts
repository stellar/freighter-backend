import * as dotEnv from "dotenv";
import { expand } from "dotenv-expand";
import yargs from "yargs";
import { Client, fetchExchange } from "@urql/core";
import Redis from "ioredis";
import Prometheus from "prom-client";

import { logger } from "./logger";
import { buildConfig } from "./config";
import { MercuryClient } from "./service/mercury";
import { initApiServer } from "./route";
import { initMetricsServer } from "./route/metrics";
import { NetworkNames } from "./helper/validate";
import {
  MercurySupportedNetworks,
  REDIS_TOGGLE_USE_MERCURY_KEY,
  REDIS_USE_MERCURY_KEY,
  hasIndexerSupport,
} from "./helper/mercury";
import { IntegrityChecker } from "./service/integrity-checker";
import { isValidMode } from "./helper/env";
import { ERROR } from "./helper/error";

interface CliArgs {
  env: string;
  port: number;
}

async function main() {
  const _config = dotEnv.config({ path: ".env" });
  expand(_config);

  const config = _config.parsed || {};
  const conf = buildConfig(config);

  const argv = yargs(process.argv).options({
    env: {
      alias: "e",
      type: "string",
      description: "env - production or development",
    },
    port: {
      alias: "p",
      type: "number",
      description: "port for server",
    },
  }).argv as CliArgs;

  const env = argv.env || conf.mode;
  if (!isValidMode(env)) {
    throw new Error(ERROR.INVALID_RUN_MODE);
  }
  const port = argv.port || 3002;

  const register = new Prometheus.Registry();
  register.setDefaultLabels({
    app: "freighter-backend",
  });
  Prometheus.collectDefaultMetrics({ register });

  const graphQlEndpoints = {
    TESTNET: conf.mercuryGraphQLTestnet,
    PUBLIC: conf.mercuryGraphQLPubnet,
  };

  const graphQlCurrentDataEndpoints = {
    TESTNET: conf.mercuryGraphQLCurrentDataTestnet,
    PUBLIC: conf.mercuryGraphQLCurrentDataPubnet,
  };

  // Why does NodeJS.fetch.RequestInfo not work for URL?
  function fetchWithTimeout(
    url: any,
    opts?: NodeJS.fetch.RequestInit
  ): Promise<NodeJS.fetch.Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 5000);

    return fetch(url, {
      ...opts,
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(id);
    });
  }

  const backends = {
    TESTNET: conf.mercuryBackendTestnet,
    PUBLIC: conf.mercuryBackendPubnet,
  };

  const renewClientMaker = (network: NetworkNames) => {
    if (!hasIndexerSupport(network)) {
      throw new Error(`network not currently supported: ${network}`);
    }

    return new Client({
      url: graphQlEndpoints[network as MercurySupportedNetworks],
      exchanges: [fetchExchange],
      fetch: fetchWithTimeout,
    });
  };

  const backendClientMaker = (network: NetworkNames, key: string) => {
    if (!hasIndexerSupport(network)) {
      throw new Error(`network not currently supported: ${network}`);
    }

    return new Client({
      url: `${graphQlEndpoints[network as MercurySupportedNetworks]}`,
      exchanges: [fetchExchange],
      fetch: fetchWithTimeout,
      fetchOptions: () => {
        return {
          headers: { authorization: `Bearer ${key}` },
        };
      },
    });
  };

  const currentDataClientMaker = (network: NetworkNames, key: string) => {
    if (!hasIndexerSupport(network)) {
      throw new Error(`network not currently supported: ${network}`);
    }

    return new Client({
      url: `${
        graphQlCurrentDataEndpoints[network as MercurySupportedNetworks]
      }`,
      exchanges: [fetchExchange],
      fetch: fetchWithTimeout,
      fetchOptions: () => {
        return {
          headers: { authorization: `Bearer ${key}` },
        };
      },
    });
  };

  const mercurySession = {
    renewClientMaker,
    backendClientMaker,
    currentDataClientMaker,
    backends,
    credentials: {
      TESTNET: {
        email: conf.mercuryEmail,
        password: conf.mercuryPassword,
      },
      PUBLIC: {
        email: conf.mercuryEmailTestnet,
        password: conf.mercuryPasswordTestnet,
      },
    },
  };

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

  let redis = undefined;
  // use in-memory store in dev
  if (env !== "development") {
    redis = new Redis({
      connectionName: conf.redisConnectionName,
      host: conf.hostname,
      port: conf.redisPort,
      maxRetriesPerRequest: 1,
    });

    redis.on("error", (error: any) => {
      logger.info("redis connection error", error);
      throw new Error(error);
    });

    await redis.set(REDIS_USE_MERCURY_KEY, String(conf.useMercury));
    await redis.set(REDIS_TOGGLE_USE_MERCURY_KEY, "true");
  }

  const mercuryClient = new MercuryClient(
    mercurySession,
    logger,
    register,
    {
      mercuryErrorCounter,
      rpcErrorCounter,
      criticalError,
    },
    redis
  );
  const server = await initApiServer(
    mercuryClient,
    logger,
    conf.useMercury,
    conf.useSorobanPublic,
    register,
    env,
    redis
  );
  const metricsServer = await initMetricsServer(register, redis);

  try {
    await server.listen({ port, host: "0.0.0.0" });
    await metricsServer.listen({ port: 9090, host: "0.0.0.0" });

    logger.info(`Running in ${env} mode`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }

  try {
    if (conf.useMercury && redis) {
      const checkNetwork = "PUBLIC";
      // initial token and userID not needed for integrity checks
      const integrityCheckMercurySession = {
        renewClientMaker,
        backendClientMaker,
        currentDataClientMaker,
        backends,
        credentials: {
          TESTNET: {
            email: conf.mercuryEmail,
            password: conf.mercuryPassword,
          },
          // need to set this to the integrity check accounts for Mercury to remove entries periodically
          PUBLIC: {
            email: conf.mercuryIntegrityCheckEmail,
            password: conf.mercuryIntegrityCheckPass,
          },
        },
      };
      const integrityCheckMercuryClient = new MercuryClient(
        integrityCheckMercurySession,
        logger,
        register,
        {
          mercuryErrorCounter,
          rpcErrorCounter,
          criticalError,
        },
        redis
      );
      const stellarClient = new IntegrityChecker(
        logger,
        integrityCheckMercuryClient,
        redis,
        register
      );
      // await stellarClient.watchLedger(checkNetwork);
    }
  } catch (err) {
    logger.error(err);
  }

  process.on("SIGTERM", async () => {
    register.clear();
    await server.close();
    process.exit(0);
  });

  process.on("SIGINT", function () {
    process.exit(0);
  });
}

process.on("uncaughtException", function (err) {
  logger.error(err);
  process.kill(process.pid, "SIGTERM");
});

process.on("unhandledRejection", function (reason: string) {
  logger.error(reason);
});

main().catch((e) => {
  logger.error(e);
  process.exit(1);
});
