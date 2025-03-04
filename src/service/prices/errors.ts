export class TokenPricesError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
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
