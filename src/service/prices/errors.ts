type ErrorName =
  | "PriceCacheInitializationError"
  | "PriceCalculationError"
  | "RedisConnectionError";

export class TokenPricesError extends Error {
  constructor(name: ErrorName, message: string, cause?: unknown) {
    super(message);
    this.name = name;
    this.cause = cause;
  }
}
