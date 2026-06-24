import {
  enforcePrincipalRateLimit,
  ONRAMP_PRINCIPAL_RATE_LIMIT,
} from "./rate-limit";

describe("enforcePrincipalRateLimit", () => {
  const sub = "GABC";

  it("allows and sets TTL on first hit", async () => {
    const redis = {
      incr: jest.fn().mockResolvedValue(1),
      ttl: jest.fn().mockResolvedValue(-1),
      expire: jest.fn().mockResolvedValue(1),
    };
    const ok = await enforcePrincipalRateLimit(redis as any, sub);
    expect(ok).toBe(true);
    expect(redis.incr).toHaveBeenCalledWith(`onramp:rl:${sub}`);
    expect(redis.expire).toHaveBeenCalledWith(`onramp:rl:${sub}`, 60);
  });

  it("does not reset the TTL on subsequent hits", async () => {
    const redis = {
      incr: jest.fn().mockResolvedValue(2),
      ttl: jest.fn().mockResolvedValue(45),
      expire: jest.fn(),
    };
    const ok = await enforcePrincipalRateLimit(redis as any, sub);
    expect(ok).toBe(true);
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it("re-sets the TTL when it is missing (self-heal)", async () => {
    const redis = {
      incr: jest.fn().mockResolvedValue(5),
      ttl: jest.fn().mockResolvedValue(-1),
      expire: jest.fn().mockResolvedValue(1),
    };
    const ok = await enforcePrincipalRateLimit(redis as any, sub);
    expect(ok).toBe(true);
    expect(redis.expire).toHaveBeenCalledWith(`onramp:rl:${sub}`, 60);
  });

  it("blocks once over the limit", async () => {
    const redis = {
      incr: jest.fn().mockResolvedValue(ONRAMP_PRINCIPAL_RATE_LIMIT + 1),
      ttl: jest.fn().mockResolvedValue(30),
      expire: jest.fn(),
    };
    expect(await enforcePrincipalRateLimit(redis as any, sub)).toBe(false);
  });

  it("allows when redis is undefined (dev/test)", async () => {
    expect(await enforcePrincipalRateLimit(undefined, sub)).toBe(true);
  });
});
