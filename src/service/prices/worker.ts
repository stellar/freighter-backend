import { Redis } from "ioredis";
import { workerData } from "worker_threads";
import { logger } from "../../logger";
import { PriceClient } from ".";

const { hostname, redisConnectionName, redisPort } = workerData;

const PRICE_UPDATE_INTERVAL = 1 * 60 * 1000; // 1 minute in milliseconds

const main = async () => {
  const redis = new Redis({
    connectionName: redisConnectionName,
    host: hostname,
    port: redisPort,
    maxRetriesPerRequest: 1,
  });

  redis.on("error", (error: any) => {
    logger.info("redis connection error", error);
    throw new Error(error);
  });

  const priceClient = new PriceClient(logger, redis);

  // Initialize cache with top 50 assets
  logger.info("Initializing price cache");
  await priceClient.initPriceCache();
  logger.info("Price cache initialized");

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
