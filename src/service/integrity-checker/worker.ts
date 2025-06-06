import { Redis } from "ioredis";
import * as Sentry from "@sentry/node";
import { workerData } from "worker_threads";

import { IntegrityChecker } from ".";
import { logger } from "../../logger";
import {
  buildBackendClientMaker,
  buildCurrentDataClientMaker,
  buildRenewClientMaker,
} from "../../helper/mercury";
import { MercuryClient } from "../mercury";
import {
  register,
  mercuryErrorCounter,
  rpcErrorCounter,
  criticalError,
} from "../../helper/metrics";

const {
  hostname,
  mercuryBackendPubnet,
  mercuryBackendTestnet,
  mercuryEmailTestnet,
  mercuryGraphQLCurrentDataPubnet,
  mercuryGraphQLCurrentDataTestnet,
  mercuryGraphQLPubnet,
  mercuryGraphQLTestnet,
  mercuryIntegrityCheckEmail,
  mercuryIntegrityCheckPass,
  mercuryPasswordTestnet,
  redisConnectionName,
  redisPort,
  sentryKey,
  stellarRpcConfig,
} = workerData;

const main = async () => {
  const sentryClient = Sentry.init({
    dsn: sentryKey,
  });

  if (!sentryKey || !sentryClient) {
    throw new Error(
      `Sentry misconfiguration, dsn: ${sentryKey}, client: ${sentryClient}`,
    );
  }

  const graphQlEndpoints = {
    TESTNET: mercuryGraphQLTestnet,
    PUBLIC: mercuryGraphQLPubnet,
  };

  const graphQlCurrentDataEndpoints = {
    TESTNET: mercuryGraphQLCurrentDataTestnet,
    PUBLIC: mercuryGraphQLCurrentDataPubnet,
  };

  const backends = {
    TESTNET: mercuryBackendTestnet,
    PUBLIC: mercuryBackendPubnet,
  };

  const redis = new Redis({
    connectionName: redisConnectionName,
    host: hostname,
    port: redisPort,
    maxRetriesPerRequest: 1,
  });

  redis.on("error", (error: any) => {
    logger.info("redis connection error", error);
    throw new Error(error);
  });

  const checkNetwork = "PUBLIC";
  // initial token and userID not needed for integrity checks
  const integrityCheckMercurySession = {
    renewClientMaker: buildRenewClientMaker(graphQlEndpoints, false),
    backendClientMaker: buildBackendClientMaker(graphQlEndpoints, false),
    currentDataClientMaker: buildCurrentDataClientMaker(
      graphQlCurrentDataEndpoints,
      false,
    ),
    backends,
    credentials: {
      TESTNET: {
        email: mercuryEmailTestnet,
        password: mercuryPasswordTestnet,
      },
      // need to set this to the integrity check accounts for Mercury to remove entries periodically
      PUBLIC: {
        email: mercuryIntegrityCheckEmail,
        password: mercuryIntegrityCheckPass,
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
    stellarRpcConfig,
    redis,
  );

  const integrityCheckerClient = new IntegrityChecker(
    logger,
    integrityCheckMercuryClient,
    redis,
    sentryClient,
  );
  await integrityCheckerClient.watchLedger(checkNetwork);
};

main().catch((e) => {
  logger.error(e);
});
