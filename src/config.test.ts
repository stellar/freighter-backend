import { buildConfig } from "./config";

// fullEnv: every ENV_KEYS entry set to a dummy value so buildConfig doesn't
// throw for missing keys. ONRAMP_AUTH_MODE is overridden per test case.
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
  ONRAMP_AUTH_MODE: "permissive",
};

describe("buildConfig onrampAuthMode validation", () => {
  it('accepts "strict"', () => {
    const conf = buildConfig({ ...fullEnv, ONRAMP_AUTH_MODE: "strict" });
    expect(conf.onrampAuthMode).toBe("strict");
  });
  it("defaults to permissive when unset", () => {
    const conf = buildConfig({ ...fullEnv, ONRAMP_AUTH_MODE: undefined });
    expect(conf.onrampAuthMode).toBe("permissive");
  });
  it("throws on an invalid value", () => {
    expect(() =>
      buildConfig({ ...fullEnv, ONRAMP_AUTH_MODE: "Dual" }),
    ).toThrow();
  });
});
