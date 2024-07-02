import Blockaid from "@blockaid/client";
import { Logger } from "pino";
import { ERROR } from "../../helper/error";

export class BlockAidService {
  blockAidClient: Blockaid;
  logger: Logger;
  constructor(blockAidClient: Blockaid, logger: Logger) {
    this.blockAidClient = blockAidClient;
    this.logger = logger;
  }

  scanDapp = async (
    url: string
  ): Promise<{
    data: Blockaid.Site.SiteScanResponse | null;
    error: string | null;
  }> => {
    try {
      const data = await this.blockAidClient.site.scan({ url });

      if (data.status === "miss") {
        return await this.scanDapp(url);
      }

      return { data, error: null };
    } catch (error) {
      this.logger.error(error);
      return { data: null, error: ERROR.UNABLE_TO_SCAN_SITE };
    }
  };
}
