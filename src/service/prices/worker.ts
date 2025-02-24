import { Redis } from "ioredis";
import { workerData } from "worker_threads";
import { logger } from "../../logger";
import { PriceClient } from ".";

const { hostname, redisConnectionName, redisPort } = workerData;

const PRICE_UPDATE_INTERVAL = 1 * 60 * 1000; // 1 minute in milliseconds
const REDIS_RECONNECT_DELAY = 5000; // 5 seconds
const MAX_RETRIES_PER_REQUEST = 3;

const main = async () => {
  const redis = new Redis({
    connectionName: redisConnectionName,
    host: hostname,
    port: redisPort,
    maxRetriesPerRequest: MAX_RETRIES_PER_REQUEST,
    retryStrategy: (_times) => {
      return REDIS_RECONNECT_DELAY;
    },
  });

  redis.on("error", (error: any) => {
    logger.error("redis connection error", error);
  });

  const priceClient = new PriceClient(logger, redis);

  // Initialize cache with top 50 assets
  logger.info("Initializing price cache");
  try {
    await priceClient.initPriceCache();
    logger.info("Price cache initialized");
  } catch (e) {
    logger.error("Failed to initialize price cache:", e);
  }

  // Update prices periodically
  setInterval(async () => {
    try {
      await priceClient.updatePrices();
      logger.info("Updated price cache");
    } catch (e) {
      logger.error("Failed to update price cache:", e);
    }
  }, PRICE_UPDATE_INTERVAL);
};

main().catch((e) => {
  logger.error(e);
});
