import Blockaid from "@blockaid/client";
import Prometheus from "prom-client";
import { Logger } from "pino";
import { Networks, TransactionBuilder } from "stellar-sdk";

import { defaultBenignResponse } from "./helpers/addScanResults";
import { ERROR } from "../../helper/error";
import { NetworkNames } from "../../helper/validate";

const NetworkNameBlockaid: {
  [index: string]: "pubnet" | "futurenet" | "testnet";
} = {
  PUBLIC: "pubnet",
  FUTURENET: "futurenet",
  TESTNET: "testnet",
};

export type BlockaidAssetScanResponse = Blockaid.Token.TokenScanResponse;

export class BlockAidService {
  blockAidClient: Blockaid;
  logger: Logger;
  scanMissCounter: Prometheus.Counter<"scanMiss">;
  constructor(
    blockAidClient: Blockaid,
    logger: Logger,
    register: Prometheus.Registry,
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
    url: string,
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
      return { data: { status: "miss" }, error: ERROR.UNABLE_TO_SCAN_SITE };
    }
  };

  scanTx = async (txXdr: string, url: string, network: NetworkNames) => {
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
          url,
        },
        transaction: txXdr,
        account_address: source,
      };
      const response = await this.blockAidClient.stellar.transaction
        .scan(body)
        .withResponse();
      const request_id = response.response.headers.get("x-request-id");

      const txData = {
        ...response.data,
        request_id,
      };
      return { data: txData, error: null };
    } catch (error) {
      this.logger.error(error);
      return { data: null, error: ERROR.UNABLE_TO_SCAN_TX };
    }
  };

  scanAsset = async (
    address: string,
  ): Promise<{
    data: Blockaid.Token.TokenScanResponse | null;
    error: string | null;
  }> => {
    try {
      const data = await this.blockAidClient.token.scan({
        address,
        chain: "stellar",
      });
      return { data, error: null };
    } catch (error) {
      this.logger.error(error);
      this.scanMissCounter.inc();
      return { data: null, error: ERROR.UNABLE_TO_SCAN_ASSET };
    }
  };

  scanAssetBulk = async (
    addressList: string[],
  ): Promise<{
    data: Blockaid.TokenBulk.TokenBulkScanResponse | null;
    error: string | null;
  }> => {
    try {
      const data = await this.blockAidClient.tokenBulk.scan({
        tokens: addressList,
        chain: "stellar",
      });
      return { data, error: null };
    } catch (error) {
      this.logger.error(error);
      this.scanMissCounter.inc();
      const defaultResponse: {
        [addres: string]: Blockaid.Token.TokenScanResponse;
      } = {};
      addressList.forEach((address) => {
        defaultResponse[address] = {
          ...defaultBenignResponse,
        };
      });

      return {
        data: { results: defaultResponse },
        error: ERROR.UNABLE_TO_SCAN_ASSET,
      };
    }
  };

  reportAssetWarning = async (details: string, address: string) => {
    try {
      const data = await this.blockAidClient.token.report({
        event: "FALSE_POSITIVE",
        details,
        report: {
          type: "params",
          params: { address, chain: "stellar" },
        },
      });
      return { data, error: null };
    } catch (error) {
      this.logger.error(error);
      return { error: ERROR.UNABLE_TO_REPORT_ASSET };
    }
  };

  reportTransactionWarning = async (
    details: string,
    id: string,
    event: "should_be_benign" | "wrong_simulation_result",
  ) => {
    try {
      const data = await this.blockAidClient.stellar.transaction.report({
        details,
        event,
        report: {
          id,
          type: "request_id",
        },
      });
      return { data, error: null };
    } catch (error) {
      this.logger.error(error);
      return { error: ERROR.UNABLE_TO_REPORT_TRANSACTION };
    }
  };
}
