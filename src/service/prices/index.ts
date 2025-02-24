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
const PRICE_HASH_KEY = "prices";
const PRICE_DECIMALS = 5;

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

    const price = await this.redisClient.hget(PRICE_HASH_KEY, redisKey);
    if (!price) {
      return await this.addNewTokenToCache(token);
    }
    return new BigNumber(price);
  };

  initPriceCache = async (): Promise<void> => {
    if (!this.redisClient) {
      return;
    }

    // Use the top 50 assets by volume to initialize the price cache
    const response = await fetch(STELLAR_EXPERT_TOP_ASSETS_URL);
    const data = await response.json();
    const pricePromises = data.assets.map((asset: any) =>
      this.calculatePriceInUSD(`${asset.code}:${asset.issuer}`, "PUBLIC")
        .then((price) => ({
          token: `${asset.code}:${asset.issuer}`,
          price: price.toFixed(PRICE_DECIMALS),
        }))
        .catch((error) => {
          this.logger.error(
            { token: `${asset.code}:${asset.issuer}` },
            "Error calculating price",
            error,
          );
          return null;
        }),
    );
    const prices = (await Promise.all(pricePromises)).filter(
      (price): price is { token: string; price: string } => price !== null,
    );

    const pipeline = this.redisClient.pipeline();
    for (const { token, price } of prices) {
      pipeline.hset(PRICE_HASH_KEY, token, price);
    }
    await pipeline.exec();

    await this.addNewTokenToCache("XLM");
  };

  addNewTokenToCache = async (token: string): Promise<BigNumber> => {
    if (!this.redisClient) {
      return new BigNumber(0);
    }
    const price = await this.calculatePriceInUSD(token, "PUBLIC");
    await this.redisClient.hset(
      PRICE_HASH_KEY,
      token,
      price.toFixed(PRICE_DECIMALS),
    );
    return price;
  };

  updatePrices = async () => {
    if (!this.redisClient) {
      return;
    }
    const trackedTokens = await this.redisClient.hkeys(PRICE_HASH_KEY);
    if (!trackedTokens) {
      return;
    }

    // Calculate new prices for all tracked tokens
    const pricePromises = trackedTokens.map((token) =>
      this.calculatePriceInUSD(token, "PUBLIC")
        .then((price) => ({
          token,
          price: price.toFixed(PRICE_DECIMALS),
        }))
        .catch((error) => {
          this.logger.error({ token }, "Error calculating price", error);
          return null;
        }),
    );
    const newPrices = (await Promise.all(pricePromises)).filter(
      (price): price is { token: string; price: string } => price !== null,
    );

    // Do a bulk update of prices using Redis pipeline
    const pipeline = this.redisClient.pipeline();
    for (const { token, price } of newPrices) {
      pipeline.hset(PRICE_HASH_KEY, token, price);
    }
    await pipeline.exec();
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
