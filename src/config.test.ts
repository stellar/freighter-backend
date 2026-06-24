import { buildConfig } from "./config";

// fullEnv: every REQUIRED ENV_KEYS entry set to a dummy value so buildConfig
// doesn't throw for missing keys. ONRAMP_AUTH_MODE is intentionally NOT a
// required key, so it's omitted here and supplied per test case.
const fullEnv: Record<string, string> = {
  AUTH_EMAIL: "user@example.com",
  AUTH_PASS: "pass",
  AUTH_EMAIL_TESTNET: "testnet@example.com",
  AUTH_PASS_TESTNET: "pass_testnet",
  HOSTNAME: "localhost",
  MODE: "development",
  REDIS_CONNECTION_NAME: "default",
  REDIS_PORT: "6379",
  USE_MERCURY: "false",
  MERCURY_INTEGRITY_CHECK_ACCOUNT_EMAIL: "integrity@example.com",
  MERCURY_INTEGRITY_CHECK_ACCOUNT_PASS: "integritypass",
  BLOCKAID_KEY: "blockaid-key",
  FREIGHTER_HORIZON_URL: "https://horizon.stellar.org",
  DISABLE_TOKEN_PRICES: "false",
  FREIGHTER_RPC_PUBNET_URL: "https://rpc.stellar.org",
};

describe("buildConfig onrampAuthMode validation", () => {
  const originalAuthMode = process.env.ONRAMP_AUTH_MODE;
  beforeEach(() => {
    // Ensure the ambient env can't leak a value into the "unset" cases.
    delete process.env.ONRAMP_AUTH_MODE;
  });
  afterAll(() => {
    if (originalAuthMode === undefined) {
      delete process.env.ONRAMP_AUTH_MODE;
    } else {
      process.env.ONRAMP_AUTH_MODE = originalAuthMode;
    }
  });

  it('accepts "strict"', () => {
    const conf = buildConfig({ ...fullEnv, ONRAMP_AUTH_MODE: "strict" });
    expect(conf.onrampAuthMode).toBe("strict");
  });
  it("does not throw and defaults to permissive when the key is absent", () => {
    // The key is omitted entirely (not set to undefined), matching a real
    // deployment whose environment never defines ONRAMP_AUTH_MODE.
    const conf = buildConfig({ ...fullEnv });
    expect(conf.onrampAuthMode).toBe("permissive");
  });
  it("throws on an invalid value", () => {
    expect(() =>
      buildConfig({ ...fullEnv, ONRAMP_AUTH_MODE: "Dual" }),
    ).toThrow();
  });
});
