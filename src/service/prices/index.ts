import { Logger } from "pino";
// import { Redis } from "ioredis";
import BigNumber from "bignumber.js";
import * as StellarSdk from "stellar-sdk";
import * as StellarSdkNext from "stellar-sdk-next";
import { getSdk } from "../../helper/stellar";
import { NETWORK_URLS } from "../../helper/horizon-rpc";
import {
  RedisClientType,
  RedisModules,
  RedisFunctions,
  RedisScripts,
} from "redis";
import TimeSeriesCommands from "@redis/time-series";
import { TimeSeriesDuplicatePolicies } from "@redis/time-series";
const STELLAR_EXPERT_TOP_ASSETS_URL =
  "https://api.stellar.expert/explorer/public/asset-list/top50";
const PRICE_TS_KEY_PREFIX = "ts:price";
const ONE_DAY = 24 * 60 * 60 * 1000; // 1 day in milliseconds
const ONE_MINUTE = 60 * 1000; // 1 minute in milliseconds
const RETENTION_PERIOD = 24 * 60 * 60 * 1000; // 1 day retention period
const USDCAsset = new StellarSdk.Asset(
  "USDC",
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
);
const NativeAsset = StellarSdk.Asset.native();
const USD_RECIEIVE_VALUE = new BigNumber(500);
const PRICE_CACHE_INITIALIZED_KEY = "price_cache_initialized";
const TOKEN_UPDATE_BATCH_SIZE = 10; // Process 10 tokens at a time
const TOKEN_COUNTER_SORTED_SET_KEY = "token_counter";
const BATCH_UPDATE_DELAY_MS = 10000; // 5 second delay between batches
const PRICE_CALCULATION_TIMEOUT_MS = 10000;

export interface TokenPriceData {
  currentPrice: BigNumber;
  percentagePriceChange24h: BigNumber | null;
}

type RedisClientWithTS = RedisClientType<
  RedisModules & { ts: typeof TimeSeriesCommands },
  RedisFunctions,
  RedisScripts
>;

export class PriceClient {
  redisClient?: RedisClientWithTS;
  logger: Logger;
  server: StellarSdk.Horizon.Server;
  constructor(logger: Logger, redisClient?: RedisClientWithTS) {
    this.redisClient = redisClient;
    this.logger = logger;
    const Sdk = getSdk(StellarSdkNext.Networks.PUBLIC);
    const { Horizon } = Sdk;
    this.server = new Horizon.Server(NETWORK_URLS.PUBLIC, {
      allowHttp: true,
    });
  }

  getPrice = async (token: string): Promise<TokenPriceData | null> => {
    if (!this.redisClient) {
      return null;
    }

    const tsKey = this.getTimeSeriesKey(token);

    try {
      const latestPrice = await this.redisClient.ts.get(tsKey);

      if (!latestPrice) {
        const newPrice = await this.addNewTokenToCache(token);
        return newPrice
          ? {
              currentPrice: newPrice,
              percentagePriceChange24h: null,
            }
          : null;
      }

      // Get 24h ago price using TS.RANGE. Use a 1 min offset as the end time.
      const dayAgo = Date.now() - ONE_DAY;
      const oldPrices = await this.redisClient.ts.range(
        tsKey,
        dayAgo,
        dayAgo + ONE_MINUTE,
        {
          COUNT: 1,
        },
      );

      const currentPrice = new BigNumber(latestPrice.value);
      let percentagePriceChange24h: BigNumber | null = null;

      if (oldPrices && oldPrices.length > 0) {
        const oldPriceBN = new BigNumber(oldPrices[0].value);
        if (!oldPriceBN.isZero()) {
          percentagePriceChange24h = currentPrice
            .minus(oldPriceBN)
            .dividedBy(oldPriceBN)
            .times(100);
        }
      }
      await this.redisClient.zIncrBy(TOKEN_COUNTER_SORTED_SET_KEY, 1, tsKey);

      return {
        currentPrice,
        percentagePriceChange24h,
      };
    } catch (error) {
      this.logger.error(
        { token },
        "Error getting price from time series",
        error,
      );
      return null;
    }
  };

  initPriceCache = async (): Promise<void> => {
    if (!this.redisClient) {
      throw new Error("Redis client not initialized");
    }

    try {
      // Get top 50 assets
      const response = await fetch(STELLAR_EXPERT_TOP_ASSETS_URL);
      const data = await response.json();
      const tokens = [
        "XLM",
        ...data.assets.map((asset: any) => `${asset.code}:${asset.issuer}`),
      ];

      for (const token of tokens) {
        const tsKey = this.getTimeSeriesKey(token);
        await this.createTimeSeries(tsKey);
      }

      // Update prices for all tokens
      await this.batchUpdatePrices(tokens);
      await this.redisClient.set(PRICE_CACHE_INITIALIZED_KEY, "true");
    } catch (error) {
      this.logger.error("Failed to initialize price cache", error);
      throw new Error("Failed to initialize price cache");
    }
  };

  updatePrices = async (): Promise<void> => {
    if (!this.redisClient) return;

    try {
      const tokens = await this.redisClient.zRange(
        TOKEN_COUNTER_SORTED_SET_KEY,
        0,
        -1,
        {
          REV: true,
        },
      );

      if (tokens.length === 0) {
        this.logger.warn("No tokens found for price update");
        return;
      }

      for (let i = 0; i < tokens.length; i += TOKEN_UPDATE_BATCH_SIZE) {
        const tokenBatch = tokens.slice(i, i + TOKEN_UPDATE_BATCH_SIZE);
        this.logger.info(
          `Processing batch ${i / TOKEN_UPDATE_BATCH_SIZE + 1} of ${Math.ceil(
            tokens.length / TOKEN_UPDATE_BATCH_SIZE,
          )}`,
        );
        await this.batchUpdatePrices(tokenBatch);

        // Add a 15s delay between batches to avoid rate limiting
        await new Promise((resolve) =>
          setTimeout(resolve, BATCH_UPDATE_DELAY_MS),
        );
      }
    } catch (error) {
      this.logger.error("Error updating prices", error);
    }
  };

  private getTimeSeriesKey(token: string): string {
    let key = token;
    if (token === "native") {
      key = "XLM";
    }
    return key;
  }

  private async batchUpdatePrices(tokens: string[]): Promise<void> {
    if (!this.redisClient) return;

    // Calculate all prices in parallel
    const pricePromises = tokens.map((token) =>
      this.calculatePriceInUSD(token)
        .then((price) => ({
          token,
          timestamp: price.timestamp,
          price: price.price,
        }))
        .catch((error) => {
          this.logger.error({ token }, "Error calculating price", error);
          return null;
        }),
    );

    const prices = (await Promise.all(pricePromises)).filter(
      (
        price,
      ): price is { token: string; timestamp: number; price: BigNumber } =>
        price !== null,
    );

    if (prices.length === 0) {
      this.logger.warn("No valid prices calculated");
      return;
    }

    try {
      const mAddEntries = prices.map(({ token, timestamp, price }) => ({
        key: this.getTimeSeriesKey(token),
        timestamp,
        value: price.toNumber(),
      }));
      await this.redisClient.ts.mAdd(mAddEntries);
    } catch (error) {
      this.logger.error("Error updating prices with TS.MADD", error);
    }
  }

  private async createTimeSeries(key: string): Promise<void> {
    if (!this.redisClient) return;

    try {
      const created = await this.redisClient.ts.create(key, {
        RETENTION: RETENTION_PERIOD,
        DUPLICATE_POLICY: TimeSeriesDuplicatePolicies.LAST,
        LABELS: {
          PRICE_CACHE_LABEL: PRICE_TS_KEY_PREFIX,
        },
      });
      const addedToSortedSet = await this.redisClient.zIncrBy(
        TOKEN_COUNTER_SORTED_SET_KEY,
        1,
        key,
      );
      this.logger.info(`Created time series ${key}`, created);
      this.logger.info(`Added to sorted set ${key}`, addedToSortedSet);
    } catch (error) {
      // Ignore if time series already exists
      if (
        !(error instanceof Error) ||
        !error.message.includes("already exists")
      ) {
        this.logger.error(`Error creating time series ${key}:`, error);
      }
    }
  }

  private addNewTokenToCache = async (token: string): Promise<BigNumber> => {
    if (!this.redisClient) {
      return new BigNumber(0);
    }
    const { timestamp, price } = await this.calculatePriceInUSD(token);
    const tsKey = this.getTimeSeriesKey(token);

    try {
      await this.createTimeSeries(tsKey);
      await this.redisClient.ts.add(tsKey, timestamp, price.toNumber());
    } catch (error) {
      this.logger.error(
        { token, price: price.toString() },
        "Error adding price to time series",
        error,
      );
    }
    return price;
  };

  private calculatePriceInUSD = async (
    token: string,
  ): Promise<{ timestamp: number; price: BigNumber }> => {
    try {
      // Add a 10s timeout to the price calculation
      const timeoutPromise = new Promise<{
        timestamp: number;
        price: BigNumber;
      }>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Price calculation timeout for ${token}`)),
          PRICE_CALCULATION_TIMEOUT_MS,
        ),
      );

      return await Promise.race([
        this.calculatePriceUsingPaths(token),
        timeoutPromise,
      ]);
    } catch (error) {
      this.logger.error({ token }, "Error calculating price:", error);
      return { timestamp: 0, price: new BigNumber(0) };
    }
  };

  private calculatePriceUsingPaths = async (
    token: string,
  ): Promise<{ timestamp: number; price: BigNumber }> => {
    let sourceAssets = undefined;
    if (token === "XLM") {
      sourceAssets = [NativeAsset];
    } else {
      const [code, issuer] = token.split(":");
      sourceAssets = [new StellarSdk.Asset(code, issuer), NativeAsset];
    }

    const latestLedger = await this.server
      .ledgers()
      .order("desc")
      .limit(1)
      .call();
    const latestLedgerTimestamp = new Date(
      latestLedger.records[0].closed_at,
    ).getTime();

    const paths = await this.server
      .strictReceivePaths(
        sourceAssets,
        USDCAsset,
        USD_RECIEIVE_VALUE.toString(),
      )
      .call();

    if (!paths.records.length) {
      this.logger.warn({ token }, "No path found");
      return { timestamp: latestLedgerTimestamp, price: new BigNumber(0) };
    }

    const tokenUnit = new BigNumber(paths.records[0].source_amount);
    const unitTokenPrice = USD_RECIEIVE_VALUE.dividedBy(tokenUnit);
    return { timestamp: latestLedgerTimestamp, price: unitTokenPrice };
  };
  //   private calculateTokenPriceUsingTradeAggregations = async (
  //     token: string,
  //     server: StellarSdk.Horizon.Server,
  //   ): Promise<BigNumber> => {
  //     try {
  //       const [code, issuer] = token.split(":");
  //       if (!code || !issuer) {
  //         throw new Error("Invalid token format. Expected 'code:issuer'");
  //       }

  //       // Get the cached XLM price first
  //       let xlmPrice = await this.getPrice("XLM");
  //       if (!xlmPrice || xlmPrice.isZero()) {
  //         xlmPrice = await this.calculateXLMPriceUsingTradeAggregations(server);
  //       }

  //       const endTime = Date.now();
  //       const startTime = endTime - ONE_HOUR;
  //       const tokenAsset = new StellarSdk.Asset(code, issuer);
  //       const tokenXlmAggregations = await server
  //         .tradeAggregation(
  //           tokenAsset,
  //           NativeAsset,
  //           startTime,
  //           endTime,
  //           RESOLUTION,
  //           0, // offset
  //         )
  //         .call();

  //       if (!tokenXlmAggregations.records.length) {
  //         this.logger.warn({ token }, "No token/XLM trade aggregations found");
  //         return new BigNumber(0);
  //       }

  //       // Calculate token price in USD by multiplying with XLM/USD price
  //       const tokenXlmPrice = new BigNumber(tokenXlmAggregations.records[0].avg);
  //       return tokenXlmPrice.times(xlmPrice);
  //     } catch (error) {
  //       this.logger.error(
  //         { token },
  //         "Error calculating price using trade aggregations",
  //         error,
  //       );
  //       return new BigNumber(0);
  //     }
  //   };

  //   private calculateXLMPriceUsingTradeAggregations = async (
  //     server: StellarSdk.Horizon.Server,
  //   ): Promise<BigNumber> => {
  //     const endTime = Date.now();
  //     const startTime = endTime - ONE_HOUR;

  //     const xlmUsdcAggregations = await server
  //       .tradeAggregation(
  //         NativeAsset,
  //         USDCAsset,
  //         startTime,
  //         endTime,
  //         RESOLUTION,
  //         0, // offset
  //       )
  //       .call();

  //     return new BigNumber(xlmUsdcAggregations.records[0].avg);
  //   };
}
