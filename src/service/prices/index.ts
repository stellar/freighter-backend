import { Logger } from "pino";
import { Redis } from "ioredis";
import { NetworkNames } from "../../helper/validate";
import BigNumber from "bignumber.js";
import * as StellarSdk from "stellar-sdk";
import * as StellarSdkNext from "stellar-sdk-next";
import { getSdk } from "../../helper/stellar";
import { NETWORK_URLS } from "../../helper/horizon-rpc";
import { ERROR } from "../../helper/error";

const STELLAR_EXPERT_TOP_ASSETS_URL =
  "https://api.stellar.expert/explorer/public/asset-list/top50";
const USDCAsset = new StellarSdk.Asset(
  "USDC",
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
);

export class PriceClient {
  redisClient?: Redis;
  logger: Logger;
  constructor(logger: Logger, redisClient?: Redis) {
    this.redisClient = redisClient;
    this.logger = logger;
  }

  getPrice = async (token: string): Promise<BigNumber | null> => {
    if (!this.redisClient) {
      return null;
    }
    let redisKey = token;
    if (token === "native") {
      redisKey = "XLM";
    }

    const price = await this.redisClient.get(redisKey);
    if (!price) {
      return await this.addNewTokenToCache(token);
    }
    return new BigNumber(price);
  };

  setPrice = async (token: string, price: number | string): Promise<void> => {
    if (!this.redisClient) {
      return;
    }
    const priceStr = new BigNumber(price).toFixed(8);
    await this.redisClient.set(token, priceStr);
  };

  initPriceCache = async (): Promise<void> => {
    if (!this.redisClient) {
      return;
    }

    // Use the top 50 assets by volume to initialize the price cache
    const response = await fetch(STELLAR_EXPERT_TOP_ASSETS_URL);
    const data = await response.json();
    for (const asset of data.assets) {
      await this.addNewTokenToCache(`${asset.code}:${asset.issuer}`);
    }
    await this.addNewTokenToCache("XLM");
  };

  addNewTokenToCache = async (token: string): Promise<BigNumber> => {
    if (!this.redisClient) {
      return new BigNumber(0);
    }
    const price = await this.calculatePriceInUSD(token, "PUBLIC");
    await this.redisClient.sadd("trackedTokens", token);
    await this.setPrice(token, price.toFixed(8));
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
      const price = await this.calculatePriceInUSD(token, "PUBLIC");
      await this.setPrice(token, price.toFixed(8));
    }
  };

  calculatePriceInUSD = async (
    token: string,
    network: NetworkNames,
  ): Promise<BigNumber> => {
    const orderbook = await this.getOrderbook(token, USDCAsset, network);

    const hasBids = orderbook.bids.length > 0;
    const hasAsks = orderbook.asks.length > 0;

    switch (true) {
      case !hasBids && !hasAsks: {
        this.logger.warn(
          { token, network },
          "Empty orderbook - no bids or asks available",
        );
        return new BigNumber(0);
      }
      case !hasAsks: {
        this.logger.info(
          { token, network },
          "Using only bid price - no asks available",
        );
        return new BigNumber(orderbook.bids[0].price);
      }
      case !hasBids: {
        this.logger.info(
          { token, network },
          "Using only ask price - no bids available",
        );
        return new BigNumber(orderbook.asks[0].price);
      }
      default: {
        // Both bids and asks are available
        return new BigNumber(
          (Number(orderbook.bids[0].price) + Number(orderbook.asks[0].price)) /
            2,
        );
      }
    }
  };

  private getOrderbook = async (
    token: string,
    buyingAsset: StellarSdk.Asset,
    network: NetworkNames,
  ): Promise<StellarSdk.Horizon.ServerApi.OrderbookRecord> => {
    const networkUrl = NETWORK_URLS[network];
    if (!networkUrl) {
      throw new Error(ERROR.UNSUPPORTED_NETWORK);
    }
    const Sdk = getSdk(StellarSdkNext.Networks[network]);
    const { Horizon } = Sdk;
    const server = new Horizon.Server(networkUrl, {
      allowHttp: !networkUrl.includes("https"),
    });

    if (token === "XLM") {
      return await server
        .orderbook(StellarSdk.Asset.native(), buyingAsset)
        .call();
    }

    // Split token string into code and issuer
    const [code, issuer] = token.split(":");
    if (!code || !issuer) {
      throw new Error("Invalid token format. Expected 'code:issuer'");
    }

    const sellingAsset = new StellarSdk.Asset(code, issuer);
    const orderbook = await server.orderbook(sellingAsset, buyingAsset).call();
    return orderbook;
  };
}
