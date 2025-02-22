import { Logger } from "pino";
import { Redis } from "ioredis";
import { NetworkNames } from "../../helper/validate";
import BigNumber from "bignumber.js";

export class PriceClient {
  redisClient?: Redis;
  logger: Logger;

  constructor(logger: Logger, redisClient?: Redis) {
    this.redisClient = redisClient;
    this.logger = logger;
  }

  getPrice = async (
    token: string,
    network: NetworkNames,
  ): Promise<BigNumber | null> => {
    if (!this.redisClient) {
      return null;
    }
    const price = await this.redisClient.get(`${token}-${network}`);
    if (!price) {
      return null;
    }
    return new BigNumber(price);
  };

  setPrice = async (
    token: string,
    network: NetworkNames,
    price: number | string,
  ): Promise<void> => {
    if (!this.redisClient) {
      return;
    }
    const priceStr = new BigNumber(price).toFixed(8);
    await this.redisClient.set(`${token}-${network}`, priceStr);
  };
}
