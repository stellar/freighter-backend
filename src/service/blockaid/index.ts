import Blockaid from "@blockaid/client";
import Prometheus from "prom-client";
import { Logger } from "pino";
import { Networks, TransactionBuilder } from "stellar-sdk";

import { ERROR } from "../../helper/error";
import { NetworkNames } from "../../helper/validate";

const NetworkNameBlockaid: { [index: string]: "pubnet" | "futurenet" } = {
  PUBLIC: "pubnet",
  FUTURENET: "futurenet",
};

export class BlockAidService {
  blockAidClient: Blockaid;
  logger: Logger;
  scanMissCounter: Prometheus.Counter<"scanMiss">;
  constructor(
    blockAidClient: Blockaid,
    logger: Logger,
    register: Prometheus.Registry
  ) {
    this.blockAidClient = blockAidClient;
    this.logger = logger;
    this.scanMissCounter = new Prometheus.Counter({
      name: "freighter_backend_scan_miss_count",
      help: "Number of times that a blockaid scan has missed",
      labelNames: ["scanMiss"],
      registers: [register],
    });
  }

  scanDapp = async (
    url: string
  ): Promise<{
    data: Blockaid.Site.SiteScanResponse | null;
    error: string | null;
  }> => {
    try {
      const data = await this.blockAidClient.site.scan({ url });
      return { data, error: null };
    } catch (error) {
      this.logger.error(error);
      this.scanMissCounter.inc();
      return { data: null, error: ERROR.UNABLE_TO_SCAN_SITE };
    }
  };

  scanTx = async (txXdr: string, network: NetworkNames) => {
    try {
      const networkPassphrase = Networks[network];
      const tx = TransactionBuilder.fromXDR(txXdr, networkPassphrase);
      let source = "";
      if ("innerTransaction" in tx) {
        source = tx.innerTransaction.source;
      } else {
        source = tx.source;
      }
      const body = {
        chain: NetworkNameBlockaid[network],
        options: ["validation", "simulation"] as Array<
          "validation" | "simulation"
        >,
        metadata: {
          type: "wallet" as "wallet",
          url: "", // TODO: can this be optional, we dont always have it
        },
        transactions: [txXdr],
        account_address: source,
      };
      const data = await this.blockAidClient.stellar.transaction.scan(body);
      return { data, error: null };
    } catch (error) {
      this.logger.error(error);
      return { data: null, error: ERROR.UNABLE_TO_SCAN_TX };
    }
  };
}
