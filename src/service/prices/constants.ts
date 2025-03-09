/**
 * Redis key that indicates whether the price cache has been successfully initialized.
 * Set to "true" after PriceClient.initPriceCache() completes successfully.
 * Used by the worker to determine if initialization is needed on startup.
 */
export const PRICE_CACHE_INITIALIZED_KEY = "price_cache_initialized";

/**
 * The interval (in milliseconds) between price updates in the worker process.
 * Set to 1 minute to ensure prices remain relatively current without excessive API calls.
 * Used in the price worker to schedule regular price updates.
 */
export const PRICE_UPDATE_INTERVAL = 1 * 60 * 1000; // 1 minute in milliseconds

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
