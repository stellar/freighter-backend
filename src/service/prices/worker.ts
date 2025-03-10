import { createClient } from "redis";
import { workerData } from "worker_threads";
import { logger } from "../../logger";
import { PriceClient } from ".";
import { ensureError } from "./errors";
import { RedisClientWithTS } from "./types";

const { hostname, redisConnectionName, redisPort } = workerData;

/**
 * Redis key that indicates whether the price cache has been successfully initialized.
 * Set to "true" after PriceClient.initPriceCache() completes successfully.
 * Used by the worker to determine if initialization is needed on startup.
 */
const PRICE_CACHE_INITIALIZED_KEY = "price_cache_initialized";

/**
 * The interval (in milliseconds) between price updates in the worker process.
 * Set to 1 minute to ensure prices remain relatively current without excessive API calls.
 * Used in the price worker to schedule regular price updates.
 */
const PRICE_UPDATE_INTERVAL = 1 * 60 * 1000; // 1 minute in milliseconds

/**
 * Number of attempts to initialize the price cache before giving up.
 * Helps handle temporary network issues during service startup.
 * Used in the price worker's initializePriceCache function.
 */
const NUM_RETRIES_CACHE_INITIALIZATION = 3;

/**
 * Delay (in milliseconds) between retry attempts for cache initialization.
 * Provides time for temporary issues to resolve before retrying.
 * Used in the price worker's initializePriceCache function.
 */
const RETRY_DELAY_MS = 30000;

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
