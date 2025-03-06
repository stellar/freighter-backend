import { createClient } from "redis";
import { workerData } from "worker_threads";
import { logger } from "../../logger";
import { PriceClient } from ".";
import {
  RedisClientType,
  RedisModules,
  RedisFunctions,
  RedisScripts,
} from "redis";
import TimeSeriesCommands from "@redis/time-series";
import { ensureError } from "./errors";
import * as Constants from "./constants";

const { hostname, redisConnectionName, redisPort } = workerData;

type RedisClientWithTS = RedisClientType<
  RedisModules & { ts: typeof TimeSeriesCommands },
  RedisFunctions,
  RedisScripts
>;

const initializePriceCache = async (
  priceClient: PriceClient,
  redisClient: RedisClientWithTS,
): Promise<void> => {
  let lastError: string | undefined;

  for (
    let attempt = 1;
    attempt <= Constants.NUM_RETRIES_CACHE_INITIALIZATION;
    attempt++
  ) {
    try {
      logger.info(
        `Attempting price cache initialization (attempt ${attempt}/${Constants.NUM_RETRIES_CACHE_INITIALIZATION})`,
      );
      await priceClient.initPriceCache();
      await redisClient.set(Constants.PRICE_CACHE_INITIALIZED_KEY, "true");
      return;
    } catch (e) {
      lastError = ensureError(e, "price cache initialization").message;
      if (attempt < Constants.NUM_RETRIES_CACHE_INITIALIZATION) {
        logger.warn(
          { error: lastError },
          `Price cache initialization attempt: ${attempt} failed, retrying in ${Constants.RETRY_DELAY_MS / 1000} seconds`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, Constants.RETRY_DELAY_MS),
        );
      }
    }
  }

  throw new Error(
    `Failed to initialize price cache after ${Constants.NUM_RETRIES_CACHE_INITIALIZATION} attempts. Last error: ${lastError}`,
  );
};

const main = async (): Promise<void> => {
  // Create Redis client with time series module enabled
  const redisClient = createClient({
    socket: {
      host: hostname,
      port: redisPort,
    },
    name: redisConnectionName,
  });
  await redisClient.connect();

  redisClient.on("error", (error: Error) => {
    logger.error({ error: error.message }, "Redis connection error");
  });

  const priceClient = new PriceClient(logger, redisClient);

  // Initialize cache with top 50 assets
  const priceCacheInitialized = await redisClient.get(
    Constants.PRICE_CACHE_INITIALIZED_KEY,
  );

  if (!priceCacheInitialized) {
    try {
      await initializePriceCache(priceClient, redisClient);
    } catch (e) {
      const error = ensureError(e, "price cache initialization");
      logger.error(error);
      process.exit(1);
    }
  } else {
    logger.info("Price cache already initialized");
  }

  // Update prices periodically
  setInterval(async () => {
    try {
      const startTime = Date.now();
      await priceClient.updatePrices();
      logger.info(`Updated price cache in ${(Date.now() - startTime) / 1000}s`);
    } catch (e) {
      const error = ensureError(e, "updating price cache");
      logger.error(error);
    }
  }, Constants.PRICE_UPDATE_INTERVAL);
};

main().catch((e) => {
  logger.error(e);
});
