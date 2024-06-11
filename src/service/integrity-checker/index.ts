import { Logger } from "pino";
import { Networks, Horizon } from "stellar-sdk";
import Prometheus from "prom-client";

import { getSdk } from "../../helper/stellar";
import { NETWORK_URLS } from "../../helper/horizon-rpc";
import { NetworkNames } from "../../helper/validate";
import { MercuryClient } from "../mercury";
import { Redis } from "ioredis";
import { REDIS_USE_MERCURY_KEY } from "../../helper/mercury";

const CHECK_INTERVAL = 10;

export class IntegrityChecker {
  logger: Logger;
  lastCheckedLedger: number;
  mercuryClient: MercuryClient;
  redisClient: Redis;
  dataIntegrityCheckPass: Prometheus.Counter<"dataIntegrityCheckPass">;
  dataIntegrityCheckFail: Prometheus.Counter<"dataIntegrityCheckFail">;

  constructor(
    logger: Logger,
    mercuryClient: MercuryClient,
    redisClient: Redis,
    register: Prometheus.Registry
  ) {
    this.logger = logger;
    this.lastCheckedLedger = 0;
    this.mercuryClient = mercuryClient;
    this.redisClient = redisClient;

    this.dataIntegrityCheckPass = new Prometheus.Counter({
      name: "freighter_backend_integrity_check_pass",
      help: "Count of times the integrity check has passed between Horizon <-> Mercury",
      labelNames: ["dataIntegrityCheckPass"],
      registers: [register],
    });
    this.dataIntegrityCheckFail = new Prometheus.Counter({
      name: "freighter_backend_integrity_check_fail",
      help: "Count of times the integrity check has failed between Horizon <-> Mercury",
      labelNames: ["dataIntegrityCheckFail"],
      registers: [register],
    });
    register.registerMetric(this.dataIntegrityCheckPass);
    register.registerMetric(this.dataIntegrityCheckFail);
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
    try {
      await this.checkOperationIntegrity(firstOp, network);
    } catch (error) {
      this.logger.error(error);
      this.dataIntegrityCheckFail.inc();
    }
  };

  checkOperationIntegrity = async (
    operation: Horizon.ServerApi.OperationRecord,
    network: NetworkNames
  ) => {
    const SKIP_KEYS = ["created_at"];
    const sourceAccount = operation.source_account;
    const opId = operation.id;
    const { error } = await this.mercuryClient.accountSubscription(
      sourceAccount,
      network
    );

    if (!error) {
      const { data: history } =
        await this.mercuryClient.getAccountHistoryMercury(
          sourceAccount,
          network
        );
      const { data: historyHorizon } =
        await this.mercuryClient.getAccountHistoryHorizon(
          sourceAccount,
          network
        );

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
              this.dataIntegrityCheckFail.inc();
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
                  this.dataIntegrityCheckFail.inc();
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
                  this.dataIntegrityCheckFail.inc();
                  await this.redisClient.set(REDIS_USE_MERCURY_KEY, "false");
                  return;
                }
              }
            }

            if (mercuryValue !== horizonValue && !SKIP_KEYS.includes(key)) {
              this.logger.error(
                `Failed check for operation ID - ${operation.id}, key - ${key}`
              );
              this.dataIntegrityCheckFail.inc();
              await this.redisClient.set(REDIS_USE_MERCURY_KEY, "false");
              return;
            } else {
              this.dataIntegrityCheckPass.inc();
              await this.redisClient.set(REDIS_USE_MERCURY_KEY, "true");
              return;
            }
          }
        } else {
          this.logger.error(
            `Failed to find matching operation from both data sources - horizon: ${JSON.stringify(
              match
            )}, mercury: ${JSON.stringify(matchHorizon)}`
          );
          this.dataIntegrityCheckFail.inc();
          await this.redisClient.set(REDIS_USE_MERCURY_KEY, "false");
        }
      } else {
        this.logger.error(
          `Failed to get history from both data sources - horizon: ${JSON.stringify(
            history
          )}, mercury: ${JSON.stringify(historyHorizon)}`
        );
        this.dataIntegrityCheckFail.inc();
        await this.redisClient.set(REDIS_USE_MERCURY_KEY, "false");
      }
    } else {
      this.logger.error(
        `Failed to subscribe to account to perform integrity check`
      );
      this.dataIntegrityCheckFail.inc();
      await this.redisClient.set(REDIS_USE_MERCURY_KEY, "false");
    }
  };
}
