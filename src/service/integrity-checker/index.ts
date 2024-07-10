import { Logger } from "pino";
import { Networks, Horizon } from "stellar-sdk";
import { Redis } from "ioredis";
import * as Sentry from "@sentry/node";
import { parentPort } from "worker_threads";

import { getSdk } from "../../helper/stellar";
import { NETWORK_URLS } from "../../helper/horizon-rpc";
import { NetworkNames } from "../../helper/validate";
import { MercuryClient } from "../mercury";
import { REDIS_USE_MERCURY_KEY } from "../../helper/mercury";
import { WorkerMessage } from "../../helper/metrics";

const CHECK_INTERVAL = 50;
const EPOCHS_TO_CHECK = 5;
const SKIP_KEYS = ["created_at"];

const alertFailure = (opId: string, client: Sentry.NodeClient) => {
  try {
    const err = new Error(
      `Failed Mercury integrity check, operation ID: ${opId}`
    );
    err.name = "Mercury integrity check failed";
    console.log("Sending Sentry alert");
    const eventId = client.captureException(err);
    console.log(eventId);
  } catch (error) {
    console.log(error);
  }
};

export class IntegrityChecker {
  logger: Logger;
  lastCheckedLedger: number;
  mercuryClient: MercuryClient;
  redisClient: Redis;
  sentryClient: Sentry.NodeClient;

  constructor(
    logger: Logger,
    mercuryClient: MercuryClient,
    redisClient: Redis,
    sentryClient: Sentry.NodeClient
  ) {
    this.logger = logger;
    this.lastCheckedLedger = 0;
    this.mercuryClient = mercuryClient;
    this.redisClient = redisClient;
    this.sentryClient = sentryClient;
  }

  watchLedger = async (network: NetworkNames, cursor: string = "now") => {
    const networkUrl = NETWORK_URLS[network];
    const sdk = getSdk(Networks[network]);
    const server = new sdk.Horizon.Server(networkUrl);
    this.logger.info("Starting ledger watcher...");
    server
      .ledgers()
      .cursor(cursor)
      .stream({
        onmessage: (ledger) => this.onNewLedger(ledger, network),
        onerror: (error) => {
          this.logger.error("Error in ledger stream:", error);
          return this.watchLedger(network, cursor);
        },
      });
  };

  onNewLedger = async (ledger: unknown, network: NetworkNames) => {
    // TODO: is ledger arg type wrong in the sdk? ServerApi.CollectionPage<ServerApi.LedgerRecord>
    const _ledger = ledger as Horizon.ServerApi.LedgerRecord;

    if (
      this.lastCheckedLedger + CHECK_INTERVAL < _ledger.sequence &&
      this.lastCheckedLedger !== 0
    ) {
      return;
    }

    this.lastCheckedLedger = _ledger.sequence;
    const ops = await _ledger.operations();
    const firstOp = ops.records[0];
    if (firstOp) {
      const redisUseMercuryFlag = await this.redisClient.get(
        REDIS_USE_MERCURY_KEY
      );
      const redisUseMercury = redisUseMercuryFlag === "true";
      try {
        await this.checkOperationIntegrity(firstOp, network, redisUseMercury);
      } catch (error) {
        this.logger.error(error);
        parentPort?.postMessage({ type: WorkerMessage.INTEGRITY_CHECK_FAIL });
        if (redisUseMercury) {
          alertFailure(firstOp.id, this.sentryClient);
        }
        await this.redisClient.set(REDIS_USE_MERCURY_KEY, "false");
      }
    }
  };

  checkHydrateAndMatchOps = async (
    hydrationId: number,
    sourceAccount: string,
    operation: Horizon.ServerApi.OperationRecord,
    network: NetworkNames,
    redisUseMercury: boolean
  ) => {
    const hydration = await this.mercuryClient.checkHydrationStatus(
      hydrationId,
      network
    );
    if (hydration.status === "complete") {
      await this.matchOperations(
        sourceAccount,
        operation,
        network,
        redisUseMercury
      );
      return;
    }

    if (hydration.status === "not complete") {
      await this.checkHydrateAndMatchOps(
        hydrationId,
        sourceAccount,
        operation,
        network,
        redisUseMercury
      );
      return;
    }
    throw new Error("hydration check error");
  };

  subscribeAndCheckOp = async (
    sourceAccount: string,
    operation: Horizon.ServerApi.OperationRecord,
    network: NetworkNames,
    redisUseMercury: boolean
  ) => {
    try {
      const { data, error } = await this.mercuryClient.accountSubscription(
        sourceAccount,
        network,
        EPOCHS_TO_CHECK
      );
      if (error) {
        throw new Error(error as any);
      }

      this.logger.info(`Subscribed to account ${sourceAccount}`);
      await this.checkHydrateAndMatchOps(
        data.id,
        sourceAccount,
        operation,
        network,
        redisUseMercury
      );
    } catch (error) {
      this.logger.error(
        `Failed to subscribe to account to perform integrity check`
      );
      this.logger.error(error);
      parentPort?.postMessage({ type: WorkerMessage.INTEGRITY_CHECK_FAIL });
      if (redisUseMercury) {
        alertFailure(operation.id, this.sentryClient);
      }
      await this.redisClient.set(REDIS_USE_MERCURY_KEY, "false");
    }
  };

  checkOperationIntegrity = async (
    operation: Horizon.ServerApi.OperationRecord,
    network: NetworkNames,
    redisUseMercury: boolean
  ) => {
    const sourceAccount = operation.source_account;
    this.logger.info(`Checking integrity of operation ID: ${operation.id}`);
    await this.subscribeAndCheckOp(
      sourceAccount,
      operation,
      network,
      redisUseMercury
    );
  };

  matchOperations = async (
    sourceAccount: string,
    operation: Horizon.ServerApi.OperationRecord,
    network: NetworkNames,
    redisUseMercury: boolean
  ) => {
    const opId = operation.id;
    const { data: history, error: mercuryHistoryError } =
      await this.mercuryClient.getAccountHistoryMercury(sourceAccount, network);
    const { data: historyHorizon } =
      await this.mercuryClient.getAccountHistoryHorizon(sourceAccount, network);

    if (history && historyHorizon) {
      const match = history.find((historyItem) => historyItem.id === opId);
      const matchHorizon = historyHorizon.find(
        (historyItem) => historyItem.id === opId
      );

      if (match && matchHorizon) {
        for (const key of Object.keys(match)) {
          const mercuryValue = (match as any)[key];
          const horizonValue = (matchHorizon as any)[key];

          if (!mercuryValue || !horizonValue) {
            this.logger.error(
              `Missing field for key ${key}, horizon: ${horizonValue}, mercury: ${mercuryValue}`
            );
            parentPort?.postMessage({
              type: WorkerMessage.INTEGRITY_CHECK_FAIL,
            });
            if (redisUseMercury) {
              alertFailure(operation.id, this.sentryClient);
            }
            await this.redisClient.set(REDIS_USE_MERCURY_KEY, "false");
            return;
          }

          // if key is array or object, check members
          if (Array.isArray(mercuryValue) && Array.isArray(horizonValue)) {
            for (var i = 0; i < mercuryValue.length; i++) {
              if (mercuryValue[i] !== horizonValue[i]) {
                this.logger.error(
                  `Failed check for operation ID - ${operation.id}, key - ${key}`
                );
                parentPort?.postMessage({
                  type: WorkerMessage.INTEGRITY_CHECK_FAIL,
                });
                if (redisUseMercury) {
                  alertFailure(operation.id, this.sentryClient);
                }
                await this.redisClient.set(REDIS_USE_MERCURY_KEY, "false");
                return;
              }
            }
          }

          if (
            mercuryValue.constructor === Object &&
            horizonValue.constructor === Object
          ) {
            for (const valKey of Object.keys(mercuryValue)) {
              if (mercuryValue[valKey] !== horizonValue[valKey]) {
                this.logger.error(
                  `Failed check for operation ID - ${operation.id}, key - ${key}`
                );
                parentPort?.postMessage({
                  type: WorkerMessage.INTEGRITY_CHECK_FAIL,
                });
                if (redisUseMercury) {
                  alertFailure(operation.id, this.sentryClient);
                }
                await this.redisClient.set(REDIS_USE_MERCURY_KEY, "false");
                return;
              }
            }
          }

          if (mercuryValue !== horizonValue && !SKIP_KEYS.includes(key)) {
            this.logger.error(
              `Failed check for operation ID - ${operation.id}, key - ${key}`
            );
            parentPort?.postMessage({
              type: WorkerMessage.INTEGRITY_CHECK_FAIL,
            });
            if (redisUseMercury) {
              alertFailure(operation.id, this.sentryClient);
            }
            await this.redisClient.set(REDIS_USE_MERCURY_KEY, "false");
            return;
          } else {
            this.logger.info(`Passed check for op ${opId}`);
            parentPort?.postMessage({
              type: WorkerMessage.INTEGRITY_CHECK_PASS,
            });
            //  no need to flip REDIS_USE_MERCURY_KEY to true, this is done manually on intervention after a failure.
            return;
          }
        }
      } else {
        if (!match) {
          this.logger.error(
            `Failed to find matching operation from Mercury, ID: ${opId}, source: ${operation.source_account}`
          );
          parentPort?.postMessage({ type: WorkerMessage.INTEGRITY_CHECK_FAIL });
          if (redisUseMercury) {
            alertFailure(operation.id, this.sentryClient);
          }
          await this.redisClient.set(REDIS_USE_MERCURY_KEY, "false");
        }
        if (!matchHorizon) {
          this.logger.error(
            `Failed to find matching operation from Horizon, ID: ${opId}`
          );
        }
      }
    } else {
      if (!historyHorizon) {
        this.logger.error(`Failed to get history from Horizon`);
      }
      if (!history) {
        this.logger.error(`Failed to get history from Mercury`);
        this.logger.error(mercuryHistoryError);
        parentPort?.postMessage({ type: WorkerMessage.INTEGRITY_CHECK_FAIL });
        if (redisUseMercury) {
          alertFailure(operation.id, this.sentryClient);
        }
        await this.redisClient.set(REDIS_USE_MERCURY_KEY, "false");
      }
    }
  };
}
