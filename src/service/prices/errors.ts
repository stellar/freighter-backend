export class TokenPricesError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "TokenPricesError";
    this.cause = cause;
  }
}

export class PathsNotFoundError extends TokenPricesError {
  constructor(token: string, cause?: unknown) {
    super(`Paths not found for token: ${token}`, cause);
    this.name = "PathsNotFoundError";
  }
}

export class PriceCalculationError extends TokenPricesError {
  constructor(token: string, cause?: unknown) {
    super(`Failed to calculate price for token: ${token}`, cause);
    this.name = "PriceCalculationError";
  }
}

export class CacheInitializationError extends TokenPricesError {
  constructor(cause?: unknown) {
    super(`Failed to initialize price cache`, cause);
    this.name = "CacheInitializationError";
  }
}

export class InvalidTokenFormatError extends TokenPricesError {
  constructor(token: string, cause?: unknown) {
    super(
      `Invalid token format: ${token}. Expected 'code:issuer' or 'XLM'`,
      cause,
    );
    this.name = "InvalidTokenFormatError";
  }
}

export const ensureError = (error: unknown, message: string): Error => {
  if (error instanceof TokenPricesError) {
    return error;
  }
  return new TokenPricesError(
    message,
    error instanceof Error ? error : undefined,
  );
};
