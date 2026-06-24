import type { Redis } from "ioredis";

export const ONRAMP_PRINCIPAL_RATE_LIMIT = 100; // per 60s

export const enforcePrincipalRateLimit = async (
  redis: Redis | undefined,
  sub: string,
): Promise<boolean> => {
  if (!redis) return true;
  const key = `onramp:rl:${sub}`;
  const count = await redis.incr(key);
  // Ensure the key always carries a TTL — even if a previous EXPIRE was lost to
  // a transient Redis failure or a crash between INCR and EXPIRE — so a
  // principal can never be rate-limited permanently. TTL < 0 means no expiry.
  const ttl = await redis.ttl(key);
  if (ttl < 0) {
    await redis.expire(key, 60);
  }
  return count <= ONRAMP_PRINCIPAL_RATE_LIMIT;
};
