import { Logger } from "pino";
import { BlockAidService } from "..";
import { NetworkNames } from "../../../helper/validate";

export const addScannedStatus = async (
  balances: { [key: string]: {} },
  blockaidService: BlockAidService,
  network: NetworkNames,
  logger: Logger
) => {
  const scannedBalances = {} as { [key: string]: { isMalicious: boolean } };
  const entries = Object.entries(balances);

  for (let i = 0; i < entries.length; i++) {
    const [key, balanceInfo] = entries[i];
    let data;
    if (key !== "native" && network === "PUBLIC") {
      // we only scan non-native assets on the public network
      try {
        const splitKey = key.split(":");
        const blockaidKey = `${splitKey[0]}-${splitKey[1]}`;

        const res = await blockaidService.scanAsset(blockaidKey);

        data = res.data;
      } catch (e) {
        logger.error(e);
      }
    }

    scannedBalances[key] = {
      ...balanceInfo,
      isMalicious: Boolean(Number(data?.malicious_score)) ?? false,
    };
  }

  return scannedBalances;
};
