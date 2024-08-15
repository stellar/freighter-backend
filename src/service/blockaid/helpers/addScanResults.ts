import { Logger } from "pino";
import { BlockAidService } from "..";
import { NetworkNames } from "../../../helper/validate";

export const addScannedStatus = async (
  balances: { [key: string]: {} },
  blockaidService: BlockAidService,
  network: NetworkNames,
  logger: Logger,
) => {
  const scannedBalances = {} as { [key: string]: { isMalicious: boolean } };
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

    // we set a default for isMalicious that, if we do scan with Blockaid, we will overwrite. Otherwise, we're done
    scannedBalances[key] = {
      ...balanceInfo,
      isMalicious: false,
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
          scannedBalances[balKey].isMalicious =
            Boolean(Number(val?.malicious_score)) || false;
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
