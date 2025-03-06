// Redis keys and prefixes
export const PRICE_TS_KEY_PREFIX = "ts:price";
export const PRICE_CACHE_INITIALIZED_KEY = "price_cache_initialized";
export const TOKEN_COUNTER_SORTED_SET_KEY = "token_counter";

// Time constants
export const ONE_DAY = 24 * 60 * 60 * 1000; // 1 day in milliseconds
export const ONE_MINUTE = 60 * 1000; // 1 minute in milliseconds
export const RETENTION_PERIOD = 24 * 60 * 60 * 1000; // 1 day retention period
export const PRICE_UPDATE_INTERVAL = 1 * 60 * 1000; // 1 minute in milliseconds
export const BATCH_UPDATE_DELAY_MS = 5000;
export const PRICE_CALCULATION_TIMEOUT_MS = 10000;

// Retry settings
export const NUM_RETRIES_CACHE_INITIALIZATION = 3;
export const RETRY_DELAY_MS = 30000; // 30 seconds

// Token settings
export const TOKEN_UPDATE_BATCH_SIZE = 150;
export const INITIAL_TOKEN_COUNT = 1000;

// API URLs
export const STELLAR_EXPERT_ALL_ASSETS_URL =
  "https://api.stellar.expert/explorer/public/asset";
export const STELLAR_EXPERT_BASE_URL = "https://api.stellar.expert";
