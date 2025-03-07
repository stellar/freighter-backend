import { Logger } from "pino";
import BigNumber from "bignumber.js";
import * as StellarSdk from "stellar-sdk";
import * as StellarSdkNext from "stellar-sdk-next";
import { getSdk } from "../../helper/stellar";
import { NETWORK_URLS } from "../../helper/horizon-rpc";
import { TimeSeriesDuplicatePolicies } from "@redis/time-series";
import { ensureError } from "./errors";
import * as Constants from "./constants";
import { RedisClientWithTS, TokenPriceData } from "./types";
const USDCAsset = new StellarSdk.Asset(
  "USDC",
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
);
const NativeAsset = StellarSdk.Asset.native();
const USD_RECIEIVE_VALUE = new BigNumber(500);

export class PriceClient {
  private readonly logger: Logger;
  private readonly server: StellarSdk.Horizon.Server;

  constructor(
    logger: Logger,
    private readonly redisClient?: RedisClientWithTS,
  ) {
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
    let latestPrice: { timestamp: number; value: number } | null = null;
    try {
      latestPrice = await this.redisClient.ts.get(tsKey);
    } catch (e) {
      return this.handleMissingToken(token);
    }

    try {
      if (!latestPrice) {
        return null;
      }

      // Get 24h ago price using TS.RANGE. Use a 1 min offset as the end time.
      const dayAgo = latestPrice.timestamp - Constants.ONE_DAY;
      const oldPrices = await this.redisClient.ts.range(
        tsKey,
        dayAgo,
        dayAgo + Constants.ONE_MINUTE,
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
      await this.redisClient.zIncrBy(
        Constants.TOKEN_COUNTER_SORTED_SET_KEY,
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

  initPriceCache = async (): Promise<void> => {
    try {
      if (!this.redisClient) {
        throw new Error("Redis client not initialized");
      }

      const tokens = await this.fetchAllTokens();
      this.logger.info(`Fetched ${tokens.length} total tokens`);

      // Create time series and sorted set for each token and add it to Redis pipeline.
      const pipeline = this.redisClient.multi();
      for (const token of tokens) {
        const tsKey = this.getTimeSeriesKey(token);
        try {
          pipeline.ts.create(tsKey, {
            RETENTION: Constants.RETENTION_PERIOD,
            DUPLICATE_POLICY: TimeSeriesDuplicatePolicies.LAST,
            LABELS: {
              PRICE_CACHE_LABEL: Constants.PRICE_TS_KEY_PREFIX,
            },
          });
          pipeline.zIncrBy(Constants.TOKEN_COUNTER_SORTED_SET_KEY, 1, tsKey);
          this.logger.info(`Created time series ${tsKey}`);
          this.logger.info(`Added to sorted set ${tsKey}`);
        } catch (error) {
          this.logger.error(
            `Error creating time series for ${token}: ${error}`,
          );
        }
      }
      await pipeline.exec();
      await this.redisClient.set(Constants.PRICE_CACHE_INITIALIZED_KEY, "true");
    } catch (error) {
      throw ensureError(error, `initializing price cache`);
    }
  };

  updatePrices = async (): Promise<void> => {
    try {
      if (!this.redisClient) {
        throw new Error("Redis client not initialized");
      }

      const tokens = await this.getTokensToUpdate();
      await this.processTokenBatches(tokens);
    } catch (e) {
      throw ensureError(e, `updating prices`);
    }
  };

  private async getTokensToUpdate(): Promise<string[]> {
    const tokens = await this.redisClient!.zRange(
      Constants.TOKEN_COUNTER_SORTED_SET_KEY,
      0,
      -1,
      { REV: true },
    );

    if (tokens.length === 0) {
      throw new Error("No tokens found in sorted set");
    }

    return tokens;
  }

  private async processTokenBatches(tokens: string[]): Promise<void> {
    for (let i = 0; i < tokens.length; i += Constants.TOKEN_UPDATE_BATCH_SIZE) {
      const tokenBatch = tokens.slice(i, i + Constants.TOKEN_UPDATE_BATCH_SIZE);
      this.logger.info(
        `Processing batch ${i / Constants.TOKEN_UPDATE_BATCH_SIZE + 1} of ${Math.ceil(
          tokens.length / Constants.TOKEN_UPDATE_BATCH_SIZE,
        )}`,
      );

      await this.addBatchToCache(tokenBatch);
      await new Promise((resolve) =>
        setTimeout(resolve, Constants.BATCH_UPDATE_DELAY_MS),
      );
    }
  }

  private async addBatchToCache(tokenBatch: string[]): Promise<void> {
    const prices = await this.calculateBatchPrices(tokenBatch);
    if (prices.length === 0) {
      throw new Error("No prices calculated");
    }

    const mAddEntries = prices.map(({ token, timestamp, price }) => ({
      key: this.getTimeSeriesKey(token),
      timestamp,
      value: price.toNumber(),
    }));
    await this.redisClient!.ts.mAdd(mAddEntries);
  }

  private async calculateBatchPrices(
    tokens: string[],
  ): Promise<{ token: string; timestamp: number; price: BigNumber }[]> {
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
        ): price is { token: string; timestamp: number; price: BigNumber } =>
          price !== null,
      );

      return prices;
    } catch (e) {
      throw ensureError(e, `calculating batch prices for ${tokens}`);
    }
  }

  private async fetchAllTokens(): Promise<string[]> {
    const tokens: string[] = ["XLM"];
    let nextUrl = `${Constants.STELLAR_EXPERT_ALL_ASSETS_URL}?sort=volume7d&order=desc`;

    while (tokens.length < Constants.INITIAL_TOKEN_COUNT && nextUrl) {
      try {
        this.logger.info(
          `Fetching assets from ${nextUrl}, current count: ${tokens.length}`,
        );
        const response = await fetch(`${nextUrl}`);
        const data = await response.json();

        if (data._embedded?.records) {
          for (const record of data._embedded.records) {
            let token: string | null = null;

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
        nextUrl = `${Constants.STELLAR_EXPERT_BASE_URL}${nextUrl}`;
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        this.logger.error(`Error fetching assets: ${error}`);
        break;
      }
    }
    return tokens;
  }

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
      return null;
    }
  };

  private getTimeSeriesKey(token: string): string {
    let key = token;
    if (token === "native") {
      key = "XLM";
    }
    return key;
  }

  private async createTimeSeries(key: string): Promise<void> {
    try {
      if (!this.redisClient) {
        throw new Error("Redis client not initialized");
      }

      await this.redisClient.ts.create(key, {
        RETENTION: Constants.RETENTION_PERIOD,
        DUPLICATE_POLICY: TimeSeriesDuplicatePolicies.LAST,
        LABELS: {
          PRICE_CACHE_LABEL: Constants.PRICE_TS_KEY_PREFIX,
        },
      });
      await this.redisClient.zIncrBy(
        Constants.TOKEN_COUNTER_SORTED_SET_KEY,
        1,
        key,
      );
      this.logger.info(`Created time series ${key}`);
      this.logger.info(`Added to sorted set ${key}`);
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
      // Add a timeout to the price calculation
      const timeoutPromise = new Promise<{
        timestamp: number;
        price: BigNumber;
      }>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Price calculation timeout for ${token}`)),
          Constants.PRICE_CALCULATION_TIMEOUT_MS,
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

      const newPaths = paths.records.filter((record) => {
        return record.source_asset_code === sourceAssets[0].code;
      });

      const tokenUnit = new BigNumber(
        newPaths.reduce(
          (min, record) => Math.min(min, Number(record.source_amount)),
          Number(paths.records[0].source_amount),
        ),
      );
      const unitTokenPrice = USD_RECIEIVE_VALUE.dividedBy(tokenUnit);
      return { timestamp: latestLedgerTimestamp, price: unitTokenPrice };
    } catch (e) {
      throw ensureError(e, `calculating price using paths for ${token}`);
    }
  };
}
