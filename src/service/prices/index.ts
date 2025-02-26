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
const NativeAsset = StellarSdk.Asset.native();
const PRICE_HASH_KEY = "prices";
const PRICE_DECIMALS = 5;
const ONE_HOUR = 60 * 60 * 1000; // 1 hour in milliseconds
const RESOLUTION = 60000; // 1 minute resolution for trade aggregations

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
    const Sdk = getSdk(StellarSdkNext.Networks.PUBLIC);
    const { Horizon } = Sdk;
    const server = new Horizon.Server(NETWORK_URLS.PUBLIC, {
      allowHttp: !NETWORK_URLS.PUBLIC.includes("https"),
    });

    // Calculate and cache XLM price first
    const xlmPrice = await this.calculateXLMPriceUsingTradeAggregations(server);
    await this.redisClient.hset(
      PRICE_HASH_KEY,
      "XLM",
      xlmPrice.toFixed(PRICE_DECIMALS),
    );

    // Use the top 50 assets by volume to initialize the price cache
    const response = await fetch(STELLAR_EXPERT_TOP_ASSETS_URL);
    const data = await response.json();
    const pricePromises = data.assets.map((asset: any) =>
      this.calculatePriceInUSD(`${asset.code}:${asset.issuer}`, server)
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
  };

  addNewTokenToCache = async (token: string): Promise<BigNumber> => {
    if (!this.redisClient) {
      return new BigNumber(0);
    }
    const Sdk = getSdk(StellarSdkNext.Networks.PUBLIC);
    const { Horizon } = Sdk;
    const server = new Horizon.Server(NETWORK_URLS.PUBLIC, {
      allowHttp: !NETWORK_URLS.PUBLIC.includes("https"),
    });

    const price = await this.calculatePriceInUSD(token, server);
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

    const Sdk = getSdk(StellarSdkNext.Networks.PUBLIC);
    const { Horizon } = Sdk;
    const server = new Horizon.Server(NETWORK_URLS.PUBLIC, {
      allowHttp: !NETWORK_URLS.PUBLIC.includes("https"),
    });

    const xlmPrice = await this.calculateXLMPriceUsingTradeAggregations(server);
    await this.redisClient.hset(
      PRICE_HASH_KEY,
      "XLM",
      xlmPrice.toFixed(PRICE_DECIMALS),
    );

    // Calculate new prices for all tracked tokens
    const pricePromises = trackedTokens
      .filter((token) => token !== "XLM")
      .map((token) =>
        this.calculateTokenPriceUsingTradeAggregations(token, server)
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

  private calculatePriceInUSD = async (
    token: string,
    server: StellarSdk.Horizon.Server,
  ): Promise<BigNumber> => {
    try {
      const tradeAggPrice =
        await this.calculateTokenPriceUsingTradeAggregations(token, server);
      return tradeAggPrice;
    } catch (error) {
      this.logger.error({ token }, "Error calculating price:", error);
      return new BigNumber(0);
    }
  };

  private calculateTokenPriceUsingTradeAggregations = async (
    token: string,
    server: StellarSdk.Horizon.Server,
  ): Promise<BigNumber> => {
    try {
      const [code, issuer] = token.split(":");
      if (!code || !issuer) {
        throw new Error("Invalid token format. Expected 'code:issuer'");
      }

      // Get the cached XLM price first
      let xlmPrice = await this.getPrice("XLM");
      if (!xlmPrice || xlmPrice.isZero()) {
        xlmPrice = await this.calculateXLMPriceUsingTradeAggregations(server);
      }

      const endTime = Date.now();
      const startTime = endTime - ONE_HOUR;
      const tokenAsset = new StellarSdk.Asset(code, issuer);
      const tokenXlmAggregations = await server
        .tradeAggregation(
          tokenAsset,
          NativeAsset,
          startTime,
          endTime,
          RESOLUTION,
          0, // offset
        )
        .call();

      if (!tokenXlmAggregations.records.length) {
        this.logger.warn({ token }, "No token/XLM trade aggregations found");
        return new BigNumber(0);
      }

      // Calculate token price in USD by multiplying with XLM/USD price
      const tokenXlmPrice = new BigNumber(tokenXlmAggregations.records[0].avg);
      return tokenXlmPrice.times(xlmPrice);
    } catch (error) {
      this.logger.error(
        { token },
        "Error calculating price using trade aggregations",
        error,
      );
      return new BigNumber(0);
    }
  };

  private calculateXLMPriceUsingTradeAggregations = async (
    server: StellarSdk.Horizon.Server,
  ): Promise<BigNumber> => {
    const endTime = Date.now();
    const startTime = endTime - ONE_HOUR;

    const xlmUsdcAggregations = await server
      .tradeAggregation(
        NativeAsset,
        USDCAsset,
        startTime,
        endTime,
        RESOLUTION,
        0, // offset
      )
      .call();

    return new BigNumber(xlmUsdcAggregations.records[0].avg);
  };

  private calculatePriceUsingOrderbook = async (
    token: string,
    network: NetworkNames,
  ): Promise<BigNumber> => {
    const networkUrl = NETWORK_URLS[network];
    if (!networkUrl) {
      throw new Error(ERROR.UNSUPPORTED_NETWORK);
    }

    const Sdk = getSdk(StellarSdkNext.Networks[network]);
    const { Horizon } = Sdk;
    const server = new Horizon.Server(networkUrl, {
      allowHttp: !networkUrl.includes("https"),
    });

    try {
      const [code, issuer] = token.split(":");
      if (!code || !issuer) {
        throw new Error("Invalid token format. Expected 'code:issuer'");
      }

      // Get the cached XLM price first
      let xlmPrice = await this.getPrice("XLM");
      if (!xlmPrice || xlmPrice.isZero()) {
        xlmPrice = await this.calculateXLMPriceUsingOrderbook(server);
      }

      const tokenAsset = new StellarSdk.Asset(code, issuer);
      const orderbook = await server
        .orderbook(tokenAsset, NativeAsset)
        .limit(1)
        .call();

      if (!orderbook.bids.length || !orderbook.asks.length) {
        this.logger.warn({ token }, "No orders found in orderbook");
        return new BigNumber(0);
      }

      // Calculate mid price from best bid and ask
      const bestBid = new BigNumber(orderbook.bids[0].price);
      const bestAsk = new BigNumber(orderbook.asks[0].price);
      const tokenXlmPrice = bestBid.plus(bestAsk).dividedBy(2);

      return tokenXlmPrice.times(xlmPrice);
    } catch (error) {
      this.logger.error(
        { token },
        "Error calculating price using orderbook",
        error,
      );
      return new BigNumber(0);
    }
  };

  private calculateXLMPriceUsingOrderbook = async (
    server: StellarSdk.Horizon.Server,
  ): Promise<BigNumber> => {
    const orderbook = await server
      .orderbook(NativeAsset, USDCAsset)
      .limit(1)
      .call();

    if (!orderbook.bids.length || !orderbook.asks.length) {
      this.logger.warn("No orders found in XLM/USDC orderbook");
      return new BigNumber(0);
    }

    // Calculate mid price from best bid and ask
    const bestBid = new BigNumber(orderbook.bids[0].price);
    const bestAsk = new BigNumber(orderbook.asks[0].price);
    return bestBid.plus(bestAsk).dividedBy(2);
  };
}
