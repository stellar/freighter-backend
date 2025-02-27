// import { Redis } from "ioredis";
import { createClient } from "redis";
import { workerData } from "worker_threads";
import { logger } from "../../logger";
import { PriceClient } from ".";

const { hostname, redisConnectionName, redisPort } = workerData;

const PRICE_UPDATE_INTERVAL = 1 * 60 * 1000; // 1 minute in milliseconds

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

  redisClient.on("error", (error: any) => {
    logger.error("redis connection error", error);
  });

  const priceClient = new PriceClient(logger, redisClient);

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
