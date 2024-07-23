import Blockaid from "@blockaid/client";
import Prometheus from "prom-client";
import { Logger } from "pino";

import { ERROR } from "../../helper/error";

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
      console.log(url);
      const data = await this.blockAidClient.site.scan({ url });
      return { data, error: null };
    } catch (error) {
      this.logger.error(error);
      this.scanMissCounter.inc();
      return { data: null, error: ERROR.UNABLE_TO_SCAN_SITE };
    }
  };
}
