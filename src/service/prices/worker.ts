import { createClient } from "redis";
import { workerData } from "worker_threads";
import { logger } from "../../logger";
import { PriceClient } from ".";
import { CacheInitializationError, ensureError } from "./errors";
import { RedisClientWithTS } from "./types";

const { hostname, redisConnectionName, redisPort, priceConfig } = workerData;

const CONFIG = {
  PRICE_CACHE_INITIALIZED_KEY: "price_cache_initialized",
  NUM_RETRIES_CACHE_INITIALIZATION: 3,
  PRICE_CACHE_INITIALIZATION_RETRY_DELAY_MS: 30000,
} as const;

async function createRedisClient(): Promise<RedisClientWithTS> {
  const client = createClient({
    socket: {
      host: hostname,
      port: redisPort,
    },
    name: redisConnectionName,
  }) as RedisClientWithTS;

  await client.connect();

  client.on("error", (error: Error) => {
    logger.error({ error: error.message }, "Redis connection error");
  });

  return client;
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function initializePriceCache(
  priceClient: PriceClient,
  redisClient: RedisClientWithTS,
): Promise<void> {
  for (
    let attempt = 1;
    attempt <= CONFIG.NUM_RETRIES_CACHE_INITIALIZATION;
    attempt++
  ) {
    try {
      logger.info(
        `Attempting price cache initialization (attempt ${attempt}/${CONFIG.NUM_RETRIES_CACHE_INITIALIZATION})`,
      );
      await priceClient.initPriceCache();
      await redisClient.set(CONFIG.PRICE_CACHE_INITIALIZED_KEY, "true");
      return;
    } catch (e) {
      const error = ensureError(e, "price cache initialization");
      if (attempt < CONFIG.NUM_RETRIES_CACHE_INITIALIZATION) {
        logger.warn(
          { error: error },
          `Price cache initialization attempt: ${attempt} failed, retrying in ${CONFIG.PRICE_CACHE_INITIALIZATION_RETRY_DELAY_MS / 1000} seconds`,
        );
        await delay(CONFIG.PRICE_CACHE_INITIALIZATION_RETRY_DELAY_MS);
      } else {
        throw new CacheInitializationError(error);
      }
    }
  }
}

async function updatePrices(priceClient: PriceClient): Promise<void> {
  const startTime = Date.now();
  try {
    await priceClient.updatePrices();
    logger.info(`Updated price cache in ${(Date.now() - startTime) / 1000}s`);
  } catch (e) {
    const error = ensureError(e, "updating price cache");
    logger.error(error);
  }
}

async function startPriceUpdateInterval(
  priceClient: PriceClient,
): Promise<void> {
  const scheduleNextUpdate = async () => {
    try {
      await updatePrices(priceClient);
    } catch (error) {
      logger.error({ error }, "Error in price update interval");
    } finally {
      setTimeout(scheduleNextUpdate, priceConfig.priceUpdateInterval);
    }
  };

  // Start the first update
  void scheduleNextUpdate();
}

async function main(): Promise<void> {
  try {
    const redisClient = await createRedisClient();
    const priceClient = new PriceClient(logger, priceConfig, redisClient);

    const priceCacheInitialized = await redisClient.get(
      CONFIG.PRICE_CACHE_INITIALIZED_KEY,
    );

    if (!priceCacheInitialized) {
      await initializePriceCache(priceClient, redisClient);
    } else {
      logger.info("Price cache already initialized");
    }

    await startPriceUpdateInterval(priceClient);
  } catch (e) {
    const error = ensureError(e, "worker initialization");
    logger.error(error);
    process.exit(1);
  }
}

void main();
