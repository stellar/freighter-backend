import Blockaid from "@blockaid/client";
import { Logger } from "pino";
import { BlockAidService } from "..";
import { NetworkNames } from "../../../helper/validate";

export const addScannedStatus = async (
  balances: { [key: string]: {} },
  blockaidService: BlockAidService,
  network: NetworkNames,
  logger: Logger,
) => {
  const scannedBalances = {} as {
    [key: string]: { blockaidData: Blockaid.Token.TokenScanResponse };
  };
  const entries = Object.entries(balances);
  const keyList: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    // iterate over the asset list and create a new list of assets for Blockaid to scan
    const [key, balanceInfo] = entries[i];
    if (key !== "native") {
      try {
        const splitKey = key.split(":");
        const blockaidKey = `${splitKey[0]}-${splitKey[1]}`;
        keyList.push(blockaidKey);
      } catch (e) {
        logger.error(e);
        logger.error(`Failed to split key: ${key}`);
      }
    }

    // set a default as Benign. If we do scan with Blockaid, we will overwrite. Otherwise, we're done
    scannedBalances[key] = {
      ...balanceInfo,
      blockaidData: {
        result_type: "Benign",
        malicious_score: "0.0",
        attack_types: {},
        chain: "stellar",
        address: "",
        metadata: {
          type: "",
        },
        fees: {},
        features: [],
        trading_limits: {},
        financial_stats: {},
      },
    };
  }

  if (network === "PUBLIC") {
    // we only scan non-native assets on the public network
    try {
      const bulkRes = await blockaidService.scanAssetBulk(keyList);

      Object.entries(bulkRes?.data?.results || {}).forEach(([key, val]) => {
        try {
          const splitKey = key.split("-");
          const balKey = `${splitKey[0]}:${splitKey[1]}`;

          // overwrite the isMalicious default with the Blockaid scan result
          scannedBalances[balKey].blockaidData = val;
        } catch (e) {
          logger.error(e);
          logger.error(`Failed to process Blockaid scan result: ${key}:${val}`);
        }
      });
    } catch (e) {
      logger.error(e);
      logger.error(`Failed to bulk scan assets: ${JSON.stringify(keyList)}`);
    }
  }

  return scannedBalances;
};
