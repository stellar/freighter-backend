// Redis keys and prefixes
/**
 * Prefix for Redis time series keys storing token price data.
 * Used in PriceClient to create consistent key naming for all token price time series.
 * Example: A token XLM would be stored with key "XLM" in Redis.
 */
export const PRICE_TS_KEY_PREFIX = "ts:price";

/**
 * Redis key that indicates whether the price cache has been successfully initialized.
 * Set to "true" after PriceClient.initPriceCache() completes successfully.
 * Used by the worker to determine if initialization is needed on startup.
 */
export const PRICE_CACHE_INITIALIZED_KEY = "price_cache_initialized";

/**
 * Redis sorted set key that tracks token access frequency.
 * Each time a token price is accessed through getPrice(), its score is incremented.
 * Used to prioritize which tokens to update most frequently based on popularity.
 */
export const TOKEN_COUNTER_SORTED_SET_KEY = "token_counter";

// Time constants
/**
 * Represents one day in milliseconds (24h * 60m * 60s * 1000ms).
 * Used when calculating 24-hour price changes in getPrice() method.
 */
export const ONE_DAY = 24 * 60 * 60 * 1000; // 1 day in milliseconds

/**
 * Represents one minute in milliseconds (60s * 1000ms).
 * Used as an offset window when looking up historical prices to handle slight timing variations.
 */
export const ONE_MINUTE = 60 * 1000; // 1 minute in milliseconds

/**
 * The time period (in milliseconds) for which to retain price data in Redis time series.
 * Currently set to 1 day to support 24-hour price change calculations while managing storage usage.
 * Used when creating new time series in createTimeSeries() method.
 */
export const RETENTION_PERIOD = 24 * 60 * 60 * 1000; // 1 day retention period

/**
 * The interval (in milliseconds) between price updates in the worker process.
 * Set to 1 minute to ensure prices remain relatively current without excessive API calls.
 * Used in the price worker to schedule regular price updates.
 */
export const PRICE_UPDATE_INTERVAL = 1 * 60 * 1000; // 1 minute in milliseconds

/**
 * Delay (in milliseconds) between processing batches of tokens during price updates.
 * Prevents overwhelming the Stellar network and API rate limits.
 * Used in processTokenBatches() method.
 */
export const BATCH_UPDATE_DELAY_MS = 5000;

/**
 * Maximum time (in milliseconds) allowed for a single token's price calculation before timing out.
 * Prevents hanging operations when the Stellar network is slow or unresponsive for a particular token.
 * Used in calculatePriceInUSD() method with Promise.race().
 */
export const PRICE_CALCULATION_TIMEOUT_MS = 10000;

// Retry settings
/**
 * Number of attempts to initialize the price cache before giving up.
 * Helps handle temporary network issues during service startup.
 * Used in the price worker's initializePriceCache function.
 */
export const NUM_RETRIES_CACHE_INITIALIZATION = 3;

/**
 * Delay (in milliseconds) between retry attempts for cache initialization.
 * Provides time for temporary issues to resolve before retrying.
 * Used in the price worker's initializePriceCache function.
 */
export const RETRY_DELAY_MS = 30000; // 30 seconds

// Token settings
/**
 * Maximum number of tokens to process in a single batch during price updates.
 * Balances update efficiency with Stellar network and Redis load.
 * Used in processTokenBatches() to slice the tokens array.
 */
export const TOKEN_UPDATE_BATCH_SIZE = 150;

/**
 * Maximum number of tokens to fetch and track prices for initially.
 * Limits the total number of tokens to manage system resource usage.
 * Used in fetchAllTokens() method to stop fetching more tokens.
 */
export const INITIAL_TOKEN_COUNT = 1000;

// API URLs
/**
 * Stellar Expert API endpoint for fetching all tradable assets.
 * Used in fetchAllTokens() method to retrieve the list of tokens to track.
 */
export const STELLAR_EXPERT_ALL_ASSETS_URL =
  "https://api.stellar.expert/explorer/public/asset";

/**
 * Base URL for Stellar Expert API calls.
 * Used to construct pagination URLs when fetching multiple pages of assets.
 */
export const STELLAR_EXPERT_BASE_URL = "https://api.stellar.expert";
