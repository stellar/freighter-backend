import { Logger } from "pino";
import BigNumber from "bignumber.js";
import * as StellarSdk from "stellar-sdk";
import * as StellarSdkNext from "stellar-sdk-next";
import { getSdk } from "../../helper/stellar";
import { NETWORK_URLS } from "../../helper/horizon-rpc";
import { TimeSeriesDuplicatePolicies } from "@redis/time-series";
import { PriceConfig } from "../../config";
import {
  InvalidTokenFormatError,
  PriceCalculationError,
  PathsNotFoundError,
  ensureError,
} from "./errors";
import {
  RedisClientWithTS,
  TokenPriceData,
  PriceCalculationResult,
  TokenKey,
  TimeSeriesEntry,
  MAddEntry,
} from "./types";

const PYUSD_TOKEN_KEY =
  "PYUSD:GDQE7IXJ4HUHV6RQHIUPRJSEZE4DRS5WY577O2FY6YQ5LVWZ7JZTU2V5";

/**
 * PriceClient is responsible for fetching, calculating, and caching token prices
 * from the Stellar network. It uses Redis time series for storing historical price data
 * and provides methods for retrieving current prices and price change percentages.
 */
export class PriceClient {
  /**
   * Stellar Asset for USDC.
   */
  private static readonly USDCAsset = new StellarSdk.Asset(
    "USDC",
    "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  );

  /**
   * Stellar Asset for the native asset (XLM).
   */
  private static readonly NativeAsset = StellarSdk.Asset.native();

  /**
   * The receiving value of the USDC asset used as the destination amount for
   * pathfinding to calculate the per-unit price of a token in USD.
   */
  private static readonly DEFAULT_USD_RECEIVE_VALUE = new BigNumber(500);

  /**
   * Redis key that indicates whether the price cache has been successfully initialized.
   * Set to "true" after PriceClient.initPriceCache() completes successfully.
   * Used by the worker to determine if initialization is needed on startup.
   */
  private static readonly PRICE_CACHE_INITIALIZED_KEY =
    "price_cache_initialized";

  /**
   * Prefix for Redis time series keys storing token price data.
   * Used to create consistent key naming for all token price time series.
   */
  private static readonly PRICE_TS_KEY_PREFIX = "ts:price";

  /**
   * Redis sorted set key that tracks token access frequency.
   * Each time a token price is accessed, its score is incremented.
   * Used to prioritize which tokens to update most frequently based on popularity.
   */
  private static readonly TOKEN_COUNTER_SORTED_SET_KEY = "token_counter";

  /**
   * Represents one day in milliseconds (24h * 60m * 60s * 1000ms).
   * Used when calculating 24-hour price changes in getPrice() method.
   */
  private static readonly ONE_DAY = 24 * 60 * 60 * 1000;

  /**
   * The time period (in milliseconds) for which to retain price data in Redis time series.
   * Currently set to 1 day in milliseconds to support 24-hour price change calculations while managing storage usage.
   */
  private static readonly RETENTION_PERIOD = 24 * 60 * 60 * 1000;

  /**
   * Delay (in milliseconds) between processing batches of tokens during price updates.
   * Prevents overwhelming the Stellar network and API rate limits.
   */
  private static readonly DEFAULT_BATCH_UPDATE_DELAY_MS = 5000;

  /**
   * Maximum time (in milliseconds) allowed for a single token's price calculation before timing out.
   * Prevents hanging operations when the Stellar network is slow or unresponsive for a particular token.
   */
  private static readonly DEFAULT_PRICE_CALCULATION_TIMEOUT_MS = 10000;

  /**
   * Maximum number of tokens to process in a single batch during price updates.
   * Balances update efficiency with Stellar network and Redis load.
   */
  private static readonly DEFAULT_TOKEN_UPDATE_BATCH_SIZE = 25;

  /**
   * The time delta (in milliseconds) to adjust the 1 day threshold by.
   * Default set to 5 minutes to account for slight timing variations.
   */
  private static readonly DEFAULT_ONE_DAY_THRESHOLD_MS = 300000;

  /**
   * Maximum number of tokens to fetch and track prices for initially.
   * Limits the total number of tokens to manage system resource usage.
   */
  private static readonly INITIAL_TOKEN_COUNT = 100;

  /**
   * Stellar Expert API endpoint for fetching all tradable assets.
   */
  private static readonly STELLAR_EXPERT_ALL_ASSETS_URL =
    "https://api.stellar.expert/explorer/public/asset";

  /**
   * Base URL for Stellar Expert API calls.
   * Used to construct pagination URLs when fetching multiple pages of assets.
   */
  private static readonly STELLAR_EXPERT_BASE_URL =
    "https://api.stellar.expert";

  private readonly logger: Logger;
  private readonly server: StellarSdk.Horizon.Server;
  private readonly batchUpdateDelayMs: number;
  private readonly calculationTimeoutMs: number;
  private readonly tokenUpdateBatchSize: number;
  private readonly usdReceiveValue: BigNumber;
  private readonly priceOneDayThresholdMs: number;

  /**
   * Creates a new PriceClient instance.
   *
   * @param logger - The logger instance for logging events and errors
   * @param redisClient - Optional Redis client with time series support for caching prices
   * @param priceConfig - Configuration object containing price-related settings
   */
  constructor(
    logger: Logger,
    priceConfig: PriceConfig,
    private readonly redisClient?: RedisClientWithTS,
  ) {
    this.logger = logger;
    const Sdk = getSdk(StellarSdkNext.Networks.PUBLIC);
    const { Horizon } = Sdk;
    this.server = new Horizon.Server(
      priceConfig?.freighterHorizonUrl || NETWORK_URLS.PUBLIC,
      {
        allowHttp: true,
      },
    );

    // Set configurable values with fallbacks to defaults
    this.batchUpdateDelayMs =
      priceConfig.batchUpdateDelayMs ||
      PriceClient.DEFAULT_BATCH_UPDATE_DELAY_MS;
    this.calculationTimeoutMs =
      priceConfig.calculationTimeoutMs ||
      PriceClient.DEFAULT_PRICE_CALCULATION_TIMEOUT_MS;
    this.tokenUpdateBatchSize =
      priceConfig.tokenUpdateBatchSize ||
      PriceClient.DEFAULT_TOKEN_UPDATE_BATCH_SIZE;
    this.usdReceiveValue = new BigNumber(
      priceConfig.usdReceiveValue || PriceClient.DEFAULT_USD_RECEIVE_VALUE,
    );
    this.priceOneDayThresholdMs =
      priceConfig.priceOneDayThresholdMs ||
      PriceClient.DEFAULT_ONE_DAY_THRESHOLD_MS;
  }

  /**
   * Retrieves the current price and 24-hour price change percentage for a token.
   * If the token is not in the cache, it also adds it to the cache.
   *
   * @param token - The token identifier in format "code:issuer" or "native" for native asset
   * @returns The token price data or null if price cannot be retrieved
   */
  getPrice = async (token: TokenKey): Promise<TokenPriceData | null> => {
    if (!this.redisClient) {
      return null;
    }

    const tsKey = this.getTimeSeriesKey(token);
    let latestPrice: TimeSeriesEntry | null = null;
    try {
      latestPrice = await this.redisClient.ts.get(tsKey);
    } catch (e) {
      return this.addNewTokenToCache(token);
    }

    try {
      if (!latestPrice) {
        this.logger.error(
          `Token in cache but no latest price found for ${token}`,
        );
        return null;
      }

      const isPyUsd = token === PYUSD_TOKEN_KEY;
      if (isPyUsd) {
        return {
          currentPrice: new BigNumber(1),
          percentagePriceChange24h: new BigNumber(0),
        };
      }

      const currentPrice = new BigNumber(latestPrice.value);
      let percentagePriceChange24h: BigNumber | null = null;
      const oneDayThreshold = PriceClient.ONE_DAY - this.priceOneDayThresholdMs;

      // When calculating the 24h price change, we want to make sure the token has been tracked for at least 24 hours.
      const firstEntry = await this.redisClient.ts.range(tsKey, "-", "+", {
        COUNT: 1,
      });
      if (
        firstEntry &&
        firstEntry.length > 0 &&
        latestPrice.timestamp - oneDayThreshold >= firstEntry[0].timestamp
      ) {
        // revRange traverses the time series in reverse chronological order.
        // We use the "-" symbol to indicate the earliest/oldest timestamp of the time series.
        // We dont use the exact 1 day calculation but use an offset of few minutes to account for slight timing variations.
        const dayAgo = latestPrice.timestamp - oneDayThreshold;
        const oldPrices = await this.redisClient.ts.revRange(
          tsKey,
          "-", // Indicates the earliest/oldest timestamp of the time series
          dayAgo, // Indicates the timestamp roughly 24 hours ago from the latest price.
          {
            COUNT: 1, // Get the single most recent entry at or before dayAgo
          },
        );

        if (oldPrices && oldPrices.length > 0) {
          const oldPriceBN = new BigNumber(oldPrices[0].value);
          if (!oldPriceBN.isZero()) {
            percentagePriceChange24h = currentPrice
              .minus(oldPriceBN)
              .dividedBy(oldPriceBN)
              .times(100);
          }
        } else {
          // This case should be less common now, but log if revRange still finds nothing
          this.logger.warn(
            `No 24h price found for ${token} despite >24h history`,
          );
        }
      } else {
        // Log if the token history is shorter than 24 hours
        this.logger.info(
          `Token ${token} history is shorter than 24h, skipping % change calculation.`,
        );
        this.logger.info(`Earliest entry: ${JSON.stringify(firstEntry)}`);
        this.logger.info(
          `Time difference: ${latestPrice.timestamp - firstEntry[0].timestamp}, 1 day threshold: ${oneDayThreshold}`,
        );
      }

      await this.redisClient.zIncrBy(
        PriceClient.TOKEN_COUNTER_SORTED_SET_KEY,
        1,
        tsKey,
      );

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

  /**
   * Initializes the price cache by fetching all tokens and creating time series
   * entries for each in Redis. This should be called once at service startup.
   *
   * @throws Error if Redis client is not initialized or price cache initialization fails
   */
  initPriceCache = async (): Promise<void> => {
    try {
      if (!this.redisClient) {
        throw new Error("Redis client not initialized");
      }

      const tokens = await this.fetchAllTokens();
      this.logger.info(`Fetched ${tokens.length} total tokens`);

      // Create time series and sorted set for each token and add it to Redis pipeline.
      // The Redis pipeline submits all the commands at once to Redis, which is more efficient than submitting them one by one.
      const pipeline = this.redisClient.multi();
      for (const token of tokens) {
        const tsKey = this.getTimeSeriesKey(token);
        try {
          pipeline.ts.create(tsKey, {
            RETENTION: PriceClient.RETENTION_PERIOD,
            DUPLICATE_POLICY: TimeSeriesDuplicatePolicies.LAST,
            LABELS: {
              PRICE_CACHE_LABEL: PriceClient.PRICE_TS_KEY_PREFIX,
            },
          });
          pipeline.zIncrBy(PriceClient.TOKEN_COUNTER_SORTED_SET_KEY, 1, tsKey);
          this.logger.info(`Creating time series ${tsKey}`);
          this.logger.info(`Adding to sorted set ${tsKey}`);
        } catch (error) {
          this.logger.error(
            `Error creating time series for ${token}: ${error}`,
          );
        }
      }
      await pipeline.exec();
      await this.redisClient.set(
        PriceClient.PRICE_CACHE_INITIALIZED_KEY,
        "true",
      );
    } catch (error) {
      throw ensureError(error, `initializing price cache`);
    }
  };

  /**
   * Updates prices for all tokens in the cache. This method should be called
   * periodically to keep prices current.
   *
   * @throws Error if Redis client is not initialized or price update fails
   */
  updatePrices = async (): Promise<void> => {
    try {
      if (!this.redisClient) {
        throw new Error("Redis client not initialized");
      }

      const tokens = await this.getTokensToUpdate();
      this.logger.info(`Updating prices for ${tokens.length} tokens`);
      await this.processTokenBatches(tokens);
    } catch (e) {
      throw ensureError(e, `updating prices`);
    }
  };

  /**
   * Retrieves tokens to update prices for, from the Redis sorted set, ordered by access frequency.
   *
   * @returns Array of token keys to update
   * @throws Error if no tokens are found in the sorted set
   * @private
   */
  private async getTokensToUpdate(): Promise<TokenKey[]> {
    const tokens = await this.redisClient!.zRange(
      PriceClient.TOKEN_COUNTER_SORTED_SET_KEY,
      0,
      -1,
      { REV: true },
    );

    if (tokens.length === 0) {
      throw new Error("No tokens found in sorted set");
    }

    return tokens;
  }

  /**
   * Processes tokens in batches to prevent overwhelming the network and API limits.
   * Each batch is processed with a delay between batches.
   *
   * @param tokens - Array of token keys to process
   * @private
   */
  private async processTokenBatches(tokens: TokenKey[]): Promise<void> {
    for (let i = 0; i < tokens.length; i += this.tokenUpdateBatchSize) {
      const tokenBatch = tokens.slice(i, i + this.tokenUpdateBatchSize);
      this.logger.info(
        `Processing batch ${i / this.tokenUpdateBatchSize + 1} of ${Math.ceil(
          tokens.length / this.tokenUpdateBatchSize,
        )}`,
      );

      await this.addBatchToCache(tokenBatch);
      await new Promise((resolve) =>
        setTimeout(resolve, this.batchUpdateDelayMs),
      );
    }
  }

  /**
   * Adds a batch of new token prices and the timestamps to the Redis timeseries structure.
   *
   * @param tokenBatch - Array of token keys to add to cache
   * @throws Error if no prices could be calculated
   * @private
   */
  private async addBatchToCache(tokenBatch: TokenKey[]): Promise<void> {
    const prices = await this.calculateBatchPrices(tokenBatch);
    if (prices.length === 0) {
      this.logger.warn("No prices calculated for batch");
      return;
    }

    const mAddEntries: MAddEntry[] = prices.map(
      ({ token, timestamp, price }) => ({
        key: this.getTimeSeriesKey(token),
        timestamp,
        value: price.toNumber(),
      }),
    );
    await this.redisClient!.ts.mAdd(mAddEntries);
  }

  /**
   * Calculates prices for a batch of tokens in parallel.
   *
   * @param tokens - Array of token keys to calculate prices for
   * @returns Array of calculated prices with token, timestamp, and price information
   * @throws Error if batch price calculation fails
   * @private
   */
  private async calculateBatchPrices(
    tokens: TokenKey[],
  ): Promise<{ token: TokenKey; timestamp: number; price: BigNumber }[]> {
    try {
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
        ): price is { token: TokenKey; timestamp: number; price: BigNumber } =>
          price !== null,
      );

      return prices;
    } catch (e) {
      throw ensureError(e, `calculating batch prices for ${tokens}`);
    }
  }

  /**
   * Fetches all tradable tokens from Stellar Expert API sorted by the rating. This ensures we start with the most
   * popular tokens in the cache.
   *
   * @returns Array of token identifiers in the format "code:issuer" or "XLM" for native asset
   * @private
   */
  private async fetchAllTokens(): Promise<TokenKey[]> {
    const tokens: TokenKey[] = ["XLM"];
    let nextUrl = `${PriceClient.STELLAR_EXPERT_ALL_ASSETS_URL}?sort=rating&order=desc`;

    while (tokens.length < PriceClient.INITIAL_TOKEN_COUNT && nextUrl) {
      try {
        this.logger.info(
          `Fetching assets from ${nextUrl}, current count: ${tokens.length}`,
        );
        const response = await fetch(`${nextUrl}`);
        const data = await response.json();

        if (data._embedded?.records) {
          for (const record of data._embedded.records) {
            let token: TokenKey | null = null;

            if (record.asset === "XLM" || record.asset === "USDC") {
              continue;
            } else if (record.tomlInfo?.code && record.tomlInfo?.issuer) {
              // Use TOML info if available
              token = `${record.tomlInfo.code}:${record.tomlInfo.issuer}`;
            } else if (record.asset && record.asset.includes("-")) {
              // Parse from asset string format: CODE-ISSUER
              const parts = record.asset.split("-");
              if (parts.length >= 2) {
                token = `${parts[0]}:${parts[1]}`;
              }
            }

            if (token && !tokens.includes(token)) {
              tokens.push(token);
            }
          }
        }

        // Check for next page
        nextUrl = data._links?.next?.href || null;
        nextUrl = `${PriceClient.STELLAR_EXPERT_BASE_URL}${nextUrl}`;
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        this.logger.error(`Error fetching assets: ${error}`);
        break;
      }
    }
    return tokens;
  }

  /**
   * Converts a token identifier to a Redis time series key.
   * Handles special case for "native" token which is converted to "XLM".
   *
   * @param token - Token identifier
   * @returns Redis time series key for the token
   * @private
   */
  private getTimeSeriesKey(token: TokenKey): string {
    let key = token;
    if (token === "native") {
      key = "XLM";
    }
    return key;
  }

  /**
   * Creates a new time series in Redis for a token and adds it to the sorted set.
   *
   * @param key - The time series key to create
   * @throws Error if Redis client is not initialized or time series creation fails
   * @private
   */
  private async createTimeSeries(key: string): Promise<void> {
    try {
      if (!this.redisClient) {
        throw new Error("Redis client not initialized");
      }

      await this.redisClient.ts.create(key, {
        RETENTION: PriceClient.RETENTION_PERIOD,
        DUPLICATE_POLICY: TimeSeriesDuplicatePolicies.LAST,
        LABELS: {
          PRICE_CACHE_LABEL: PriceClient.PRICE_TS_KEY_PREFIX,
        },
      });
      await this.redisClient.zIncrBy(
        PriceClient.TOKEN_COUNTER_SORTED_SET_KEY,
        1,
        key,
      );
      this.logger.info(`Created time series ${key}`);
      this.logger.info(`Added to sorted set ${key}`);
    } catch (e) {
      throw ensureError(e, `creating time series for ${key}`);
    }
  }

  /**
   * Adds a new token to the Redis price cache by calculating its current price
   * and creating a time series for it.
   *
   * @param token - Token identifier to add to cache
   * @returns The token price data or null if price calculation fails
   * @throws Error if Redis client is not initialized or adding token to cache fails
   * @private
   */
  private addNewTokenToCache = async (
    token: TokenKey,
  ): Promise<TokenPriceData | null> => {
    try {
      if (!this.redisClient) {
        throw new Error("Redis client not initialized");
      }

      let tsKey: string;
      try {
        tsKey = this.getTimeSeriesKey(token);
        await this.createTimeSeries(tsKey);
      } catch (e) {
        throw new Error(`creating time series for ${token}`);
      }

      const { timestamp, price } = await this.calculatePriceInUSD(token);

      try {
        await this.redisClient.ts.add(tsKey, timestamp, price.toNumber());
      } catch (e) {
        throw new Error(`adding price to time series for ${token}`);
      }

      return {
        currentPrice: price,
        percentagePriceChange24h: null,
      } as TokenPriceData;
    } catch (e) {
      const error = ensureError(e, `adding new token to cache for ${token}`);
      this.logger.error(error);
      return null;
    }
  };

  /**
   * Calculates the price of a token in USD with a timeout to prevent hanging.
   *
   * @param token - Token identifier to calculate price for
   * @returns Object containing timestamp and price in USD
   * @throws Error if price calculation fails or times out
   * @private
   */
  private calculatePriceInUSD = async (
    token: TokenKey,
  ): Promise<PriceCalculationResult> => {
    try {
      const timeoutPromise = new Promise<PriceCalculationResult>((_, reject) =>
        setTimeout(
          () => reject(new PriceCalculationError(token)),
          this.calculationTimeoutMs,
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

  /**
   * Calculates the price of a token in USD using Horizon's path finding functionality.
   * Finds paths from the token to USDC and calculates the exchange rate.
   *
   * @param token - Token identifier to calculate price for
   * @returns Object containing timestamp and price in USD
   * @throws Error if no paths are found or price calculation fails
   * @private
   */
  private calculatePriceUsingPaths = async (
    token: TokenKey,
  ): Promise<PriceCalculationResult> => {
    try {
      let sourceAssets = undefined;
      if (token === "XLM") {
        sourceAssets = [PriceClient.NativeAsset];
      } else {
        const [code, issuer] = token.split(":");
        if (!code || !issuer) {
          throw new InvalidTokenFormatError(token);
        }
        sourceAssets = [new StellarSdk.Asset(code, issuer)];
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
          PriceClient.USDCAsset,
          this.usdReceiveValue.toString(),
        )
        .call();
      if (!paths.records.length) {
        throw new PathsNotFoundError(token);
      }

      const tokenUnit = new BigNumber(
        paths.records.reduce(
          (min, record) => Math.min(min, Number(record.source_amount)),
          Number(paths.records[0].source_amount),
        ),
      );
      const unitTokenPrice = this.usdReceiveValue.dividedBy(tokenUnit);
      return {
        timestamp: latestLedgerTimestamp,
        price: unitTokenPrice,
      } as PriceCalculationResult;
    } catch (e) {
      throw ensureError(e, `calculating price using paths for ${token}`);
    }
  };
}
