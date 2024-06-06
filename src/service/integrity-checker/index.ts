import { Logger } from "pino";
import { Networks, Horizon } from "stellar-sdk";

import { getSdk } from "../../helper/stellar";
import { NETWORK_URLS } from "../../helper/horizon-rpc";
import { NetworkNames } from "../../helper/validate";
import { MercuryClient } from "../mercury";

const CHECK_INTERVAL = 10;

export class IntegrityChecker {
  logger: Logger;
  lastCheckedLedger: number;
  mercuryClient: MercuryClient;
  constructor(logger: Logger, mercuryClient: MercuryClient) {
    this.logger = logger;
    this.lastCheckedLedger = 0;
    this.mercuryClient = mercuryClient;
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

            // if key is array or object, check members
            if (Array.isArray(mercuryValue) && Array.isArray(horizonValue)) {
              for (var i = 0; i < mercuryValue.length; i++) {
                if (mercuryValue[i] !== horizonValue[i]) {
                  this.logger.error(
                    `Failed check for operation ID - ${operation.id}, key - ${key}`
                  );
                  // record metric, set off alert, etc.
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
                  // record metric, set off alert, etc.
                }
              }
            }

            if (mercuryValue !== horizonValue && !SKIP_KEYS.includes(key)) {
              this.logger.error(
                `Failed check for operation ID - ${operation.id}, key - ${key}`
              );
              // record metric, set off alert, etc.
            }
          }
        }
      }
    }
  };
}
