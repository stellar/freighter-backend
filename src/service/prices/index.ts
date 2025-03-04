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
import { ensureError } from "./errors";
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
        return this.handleMissingToken(token);
      }

      // Get 24h ago price using TS.RANGE. Use a 1 min offset as the end time.
      const dayAgo = latestPrice.timestamp - ONE_DAY;
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
    } catch (e) {
      const error = ensureError(
        e,
        `getting price from time series for ${token}`,
      );
      this.logger.error(error);
      return null;
    }
  };

  initPriceCache = async (): Promise<void> => {
    if (!this.redisClient) {
      throw new Error("Redis client not initialized");
    }

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
  };

  updatePrices = async (): Promise<void> => {
    try {
      if (!this.redisClient) {
        throw new Error("Redis client not initialized");
      }

      const tokens = await this.redisClient.zRange(
        TOKEN_COUNTER_SORTED_SET_KEY,
        0,
        -1,
        {
          REV: true,
        },
      );

      if (tokens.length === 0) {
        throw new Error("No tokens found in sorted set");
      }

      // Process tokens in batches and in decreasing order of popularity (number of times requested).
      // This ensures that the most popular tokens are updated first.
      for (let i = 0; i < tokens.length; i += TOKEN_UPDATE_BATCH_SIZE) {
        const tokenBatch = tokens.slice(i, i + TOKEN_UPDATE_BATCH_SIZE);
        this.logger.info(
          `Processing batch ${i / TOKEN_UPDATE_BATCH_SIZE + 1} of ${Math.ceil(
            tokens.length / TOKEN_UPDATE_BATCH_SIZE,
          )}`,
        );
        await this.batchUpdatePrices(tokenBatch);

        // Add a delay between batches to avoid overloading the price calculation source API.
        await new Promise((resolve) =>
          setTimeout(resolve, BATCH_UPDATE_DELAY_MS),
        );
      }
    } catch (e) {
      throw ensureError(e, `updating prices`);
    }
  };

  private handleMissingToken = async (
    token: string,
  ): Promise<TokenPriceData | null> => {
    try {
      const newPrice = await this.addNewTokenToCache(token);
      return newPrice
        ? { currentPrice: newPrice, percentagePriceChange24h: null }
        : null;
    } catch (e) {
      const error = ensureError(
        e,
        `adding missing token to cache for ${token}`,
      );
      this.logger.error(error);
      throw error;
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
    try {
      if (!this.redisClient) {
        throw new Error("Redis client not initialized");
      }

      // Calculate all prices in parallel
      const pricePromises = tokens.map((token) =>
        this.calculatePriceInUSD(token)
          .then((price) => ({
            token,
            timestamp: price.timestamp,
            price: price.price,
          }))
          .catch((e) => {
            const error = ensureError(e, `calculating price for ${token}`);
            this.logger.error(error);
            return null;
          }),
      );

      // Filter out null responses - these are tokens for which we failed to calculate a price.
      const prices = (await Promise.all(pricePromises)).filter(
        (
          price,
        ): price is { token: string; timestamp: number; price: BigNumber } =>
          price !== null,
      );

      if (prices.length === 0) {
        throw new Error("No prices calculated");
      }

      const mAddEntries = prices.map(({ token, timestamp, price }) => ({
        key: this.getTimeSeriesKey(token),
        timestamp,
        value: price.toNumber(),
      }));
      await this.redisClient.ts.mAdd(mAddEntries);
    } catch (e) {
      throw ensureError(e, `batch updating prices`);
    }
  }

  private async createTimeSeries(key: string): Promise<void> {
    try {
      if (!this.redisClient) {
        throw new Error("Redis client not initialized");
      }

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
    } catch (e) {
      throw ensureError(e, `creating time series for ${key}`);
    }
  }

  private addNewTokenToCache = async (
    token: string,
  ): Promise<BigNumber | null> => {
    try {
      if (!this.redisClient) {
        throw new Error("Redis client not initialized");
      }

      const { timestamp, price } = await this.calculatePriceInUSD(token);
      const tsKey = this.getTimeSeriesKey(token);

      await this.createTimeSeries(tsKey);
      await this.redisClient.ts.add(tsKey, timestamp, price.toNumber());
      return price;
    } catch (e) {
      throw ensureError(e, `adding new token to cache for ${token}`);
    }
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
    } catch (e) {
      throw ensureError(e, `calculating price for ${token}`);
    }
  };

  private calculatePriceUsingPaths = async (
    token: string,
  ): Promise<{ timestamp: number; price: BigNumber }> => {
    try {
      let sourceAssets = undefined;
      if (token === "XLM") {
        sourceAssets = [NativeAsset];
      } else {
        const [code, issuer] = token.split(":");
        if (!code || !issuer) {
          throw new Error(
            `Invalid token format: ${token}. Expected 'code:issuer'`,
          );
        }
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
        throw new Error(`No paths found for ${token}`);
      }

      const tokenUnit = new BigNumber(paths.records[0].source_amount);
      const unitTokenPrice = USD_RECIEIVE_VALUE.dividedBy(tokenUnit);
      return { timestamp: latestLedgerTimestamp, price: unitTokenPrice };
    } catch (e) {
      throw ensureError(e, `calculating price using paths for ${token}`);
    }
  };
}
