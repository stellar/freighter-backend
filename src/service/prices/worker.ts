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
const { hostname, redisConnectionName, redisPort } = workerData;
const PRICE_UPDATE_INTERVAL = 1 * 60 * 1000; // 1 minute in milliseconds
const PRICE_CACHE_INITIALIZED_KEY = "price_cache_initialized";
const NUM_RETRIES_CACHE_INITIALIZATION = 3;
const RETRY_DELAY_MS = 30000; // 30 seconds in milliseconds
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
    attempt <= NUM_RETRIES_CACHE_INITIALIZATION;
    attempt++
  ) {
    try {
      logger.info(
        `Attempting price cache initialization (attempt ${attempt}/${NUM_RETRIES_CACHE_INITIALIZATION})`,
      );
      await priceClient.initPriceCache();
      await redisClient.set(PRICE_CACHE_INITIALIZED_KEY, "true");
      return;
    } catch (e) {
      lastError = ensureError(e, "price cache initialization").message;
      if (attempt < NUM_RETRIES_CACHE_INITIALIZATION) {
        logger.warn(
          { error: lastError },
          `Price cache initialization attempt: ${attempt} failed, retrying in ${RETRY_DELAY_MS / 1000} seconds`,
        );
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  throw new Error(
    `Failed to initialize price cache after ${NUM_RETRIES_CACHE_INITIALIZATION} attempts. Last error: ${lastError}`,
  );
};

const main = async () => {
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
    PRICE_CACHE_INITIALIZED_KEY,
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
  }, PRICE_UPDATE_INTERVAL);
};

main().catch((e) => {
  logger.error(e);
});
