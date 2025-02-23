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
      return await this.addNewTokenToCache(token);
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

  // Use the top 50 assets by volume to initialize the price cache
  initPriceCache = async (): Promise<void> => {
    if (!this.redisClient) {
      return;
    }

    const response = await fetch(
      "https://api.stellar.expert/explorer/public/asset-list/top50",
    );
    const data = await response.json();
    for (const asset of data.assets) {
      await this.addNewTokenToCache(`${asset.code}:${asset.issuer}`);
    }
  };

  addNewTokenToCache = async (token: string): Promise<BigNumber> => {
    if (!this.redisClient) {
      return new BigNumber(0);
    }
    const price = await this.calculatePrice(token, "PUBLIC");
    await this.redisClient.sadd("trackedTokens", token);
    await this.setPrice(token, "PUBLIC", price.toFixed(8));
    return price;
  };

  updatePrices = async () => {
    if (!this.redisClient) {
      return;
    }
    const trackedTokens = await this.redisClient.smembers("trackedTokens");
    if (!trackedTokens) {
      return;
    }
    for (const token of trackedTokens) {
      const price = await this.calculatePrice(token, "PUBLIC");
      await this.setPrice(token, "PUBLIC", price.toFixed(8));
    }
  };

  calculatePrice = async (
    _token: string,
    _network: NetworkNames,
  ): Promise<BigNumber> => {
    return new BigNumber(Math.random());
  };
}
