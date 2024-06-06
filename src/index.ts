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
import { MercurySupportedNetworks, hasIndexerSupport } from "./helper/mercury";
import { IntegrityChecker } from "./service/integrity-checker";

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

  const env = argv.env || "development";
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
    });
  };

  const backendClientMaker = (
    network: NetworkNames,
    key: string = conf.mercuryKey
  ) => {
    if (!hasIndexerSupport(network)) {
      throw new Error(`network not currently supported: ${network}`);
    }

    return new Client({
      url: `${graphQlEndpoints[network as MercurySupportedNetworks]}`,
      exchanges: [fetchExchange],
      fetchOptions: () => {
        return {
          headers: { authorization: `Bearer ${key}` },
        };
      },
    });
  };

  const currentDataClientMaker = (
    network: NetworkNames,
    key: string = conf.mercuryKey
  ) => {
    if (!hasIndexerSupport(network)) {
      throw new Error(`network not currently supported: ${network}`);
    }

    return new Client({
      url: `${
        graphQlCurrentDataEndpoints[network as MercurySupportedNetworks]
      }`,
      exchanges: [fetchExchange],
      fetchOptions: () => {
        return {
          headers: { authorization: `Bearer ${key}` },
        };
      },
    });
  };

  const mercurySession = {
    token: conf.mercuryKey,
    renewClientMaker,
    backendClientMaker,
    currentDataClientMaker,
    backends,
    email: conf.mercuryEmail,
    password: conf.mercuryPassword,
    userId: conf.mercuryUserId,
  };

  let redis = undefined;
  // use in-memory store in dev
  if (conf.mode !== "development") {
    redis = new Redis({
      connectionName: conf.redisConnectionName,
      host: conf.hostname,
      port: conf.redisPort,
      maxRetriesPerRequest: 1,
    });

    redis.on("error", (error) => {
      logger.error(error);
      throw new Error(JSON.stringify(error));
    });
  }

  const mercuryClient = new MercuryClient(
    mercurySession,
    logger,
    register,
    redis
  );
  const server = await initApiServer(
    mercuryClient,
    logger,
    conf.useMercury,
    conf.useSorobanPublic,
    register,
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
    const stellarClient = new IntegrityChecker(logger, mercuryClient, register);
    await stellarClient.watchLedger("PUBLIC");
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
