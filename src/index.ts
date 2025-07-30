import * as dotEnv from "dotenv";
import { expand } from "dotenv-expand";
import yargs from "yargs";
import Redis from "ioredis";
import { createClient } from "redis";
import Prometheus from "prom-client";
import { Worker } from "worker_threads";
import Blockaid from "@blockaid/client";

import { logger } from "./logger";
import { buildConfig } from "./config";
import { MercuryClient } from "./service/mercury";
import { initApiServer } from "./route";
import { initMetricsServer } from "./route/metrics";
import {
  REDIS_USE_MERCURY_KEY,
  buildBackendClientMaker,
  buildCurrentDataClientMaker,
  buildRenewClientMaker,
} from "./helper/mercury";
import { isValidMode, mode } from "./helper/env";
import { ERROR } from "./helper/error";
import {
  register,
  mercuryErrorCounter,
  rpcErrorCounter,
  criticalError,
  WorkerMessage,
  dataIntegrityCheckFail,
  dataIntegrityCheckPass,
} from "./helper/metrics";
import { fetchWithTimeout } from "./helper/fetch";
import { BlockAidService } from "./service/blockaid";
import { PriceClient } from "./service/prices";

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

  const mercurySession = {
    renewClientMaker: buildRenewClientMaker(graphQlEndpoints),
    backendClientMaker: buildBackendClientMaker(graphQlEndpoints),
    currentDataClientMaker: buildCurrentDataClientMaker(
      graphQlCurrentDataEndpoints,
    ),
    backends,
    credentials: {
      PUBLIC: {
        email: conf.mercuryEmail,
        password: conf.mercuryPassword,
      },
      TESTNET: {
        email: conf.mercuryEmailTestnet,
        password: conf.mercuryPasswordTestnet,
      },
    },
  };

  let redis = undefined;
  let timeSeriesRedis = undefined;

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

    // Separate Redis client for time series operations
    timeSeriesRedis = createClient({
      socket: {
        host: conf.hostname,
        port: conf.redisPort,
      },
      name: conf.redisConnectionName,
    });
    await timeSeriesRedis.connect();

    timeSeriesRedis.on("error", (error: any) => {
      logger.info("redis time series connection error", error);
      throw new Error(error);
    });
  }

  const blockAidClient = new Blockaid({
    apiKey: conf.blockAidKey,
    fetch: fetchWithTimeout,
  });
  const blockAidService = new BlockAidService(blockAidClient, logger, register);

  const mercuryClient = new MercuryClient(
    mercurySession,
    logger,
    register,
    {
      mercuryErrorCounter,
      rpcErrorCounter,
      criticalError,
    },
    conf.stellarRpcConfig,
    redis,
  );

  const priceClient = new PriceClient(
    logger,
    conf.priceConfig,
    timeSeriesRedis,
  );
  const server = await initApiServer(
    mercuryClient,
    blockAidService,
    priceClient,
    logger,
    conf.useMercury,
    conf.useSorobanPublic,
    register,
    env as mode,
    conf.blockaidConfig,
    conf.coinbaseConfig,
    conf.priceConfig,
    conf.stellarRpcConfig,
    conf.trustProxyRange,
    redis,
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
    // Start price update worker
    if (env !== "development" && redis && !conf.disableTokenPrices) {
      const priceWorkerData = {
        workerData: {
          hostname: conf.hostname,
          redisConnectionName: conf.redisConnectionName,
          redisPort: conf.redisPort,
          priceConfig: conf.priceConfig,
        },
      };

      const startPriceWorker = (retryCount = 0) => {
        const maxRetries = 10;
        const baseDelay = 1000; // 1 second
        const maxDelay = 300000; // 5 minutes

        const priceWorker = new Worker(
          "./build/price-worker.js",
          priceWorkerData,
        );

        priceWorker.on("error", (e) => {
          logger.error("Price worker error:", e);
          priceWorker.terminate();
        });

        priceWorker.on("exit", (code) => {
          logger.info(`Price worker exited with code ${code}`);

          // Non-zero exit code indicates abnormal termination
          if (code !== 0) {
            const delay = Math.min(
              baseDelay * Math.pow(2, retryCount),
              maxDelay,
            );

            if (retryCount < maxRetries) {
              logger.info(
                `Restarting price worker in ${delay}ms (attempt ${retryCount + 1}/${maxRetries})`,
              );
              setTimeout(() => startPriceWorker(retryCount + 1), delay);
            } else {
              logger.error(
                "Max retry attempts reached for price worker. Manual intervention required.",
              );
              criticalError.inc();
            }
          }
        });

        return priceWorker;
      };

      startPriceWorker();
    }

    // the worker is not properly instantiated when running this app with ts-node
    // if you need to test this, build the app with webpack and run the build with node manually
    if (conf.useMercury && env !== "development") {
      const workerData = {
        workerData: {
          hostname: conf.hostname,
          mercuryBackendPubnet: conf.mercuryBackendPubnet,
          mercuryBackendTestnet: conf.mercuryBackendTestnet,
          mercuryEmailTestnet: conf.mercuryEmailTestnet,
          mercuryGraphQLCurrentDataPubnet: conf.mercuryGraphQLCurrentDataPubnet,
          mercuryGraphQLCurrentDataTestnet:
            conf.mercuryGraphQLCurrentDataTestnet,
          mercuryGraphQLPubnet: conf.mercuryGraphQLPubnet,
          mercuryGraphQLTestnet: conf.mercuryGraphQLTestnet,
          mercuryIntegrityCheckEmail: conf.mercuryIntegrityCheckEmail,
          mercuryIntegrityCheckPass: conf.mercuryIntegrityCheckPass,
          mercuryPasswordTestnet: conf.mercuryPasswordTestnet,
          redisConnectionName: conf.redisConnectionName,
          redisPort: conf.redisPort,
          sentryKey: conf.sentryKey,
          stellarRpcConfig: conf.stellarRpcConfig,
        },
      };
      const integrityCheckWorker = new Worker("./build/worker.js", workerData);
      integrityCheckWorker.on("message", (message) => {
        const { type } = message;
        switch (type) {
          case WorkerMessage.INTEGRITY_CHECK_FAIL: {
            dataIntegrityCheckFail.inc();
            return;
          }
          case WorkerMessage.INTEGRITY_CHECK_PASS: {
            dataIntegrityCheckPass.inc();
            return;
          }

          default: {
            logger.error(`Worker message type not supported: ${type}`);
          }
        }
      });
      integrityCheckWorker.on("error", (e) => {
        logger.error(e);
        integrityCheckWorker.terminate();
      });
      integrityCheckWorker.on("exit", () => {
        logger.info("Integrity checker worker exited");
      });
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
