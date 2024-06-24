import { ERROR } from "./helper/error";

const ENV_KEYS = [
  "AUTH_EMAIL",
  "AUTH_PASS",
  "AUTH_EMAIL_TESTNET",
  "AUTH_PASS_TESTNET",
  "HOSTNAME",
  "MERCURY_KEY",
  "MERCURY_USER_ID",
  "MODE",
  "REDIS_CONNECTION_NAME",
  "REDIS_PORT",
  "USE_MERCURY",
  "MERCURY_INTEGRITY_CHECK_ACCOUNT_EMAIL",
  "MERCURY_INTEGRITY_CHECK_ACCOUNT_PASS",
];

export function buildConfig(config: Record<string, string>) {
  const configKeys = Object.keys(config);
  const missingKeys = [] as string[];

  const isMissingKeys = ENV_KEYS.every((key) => {
    if (configKeys.includes(key) || process.env[key]) {
      return true;
    }
    missingKeys.push(key);
    return false;
  });
  if (!isMissingKeys) {
    throw new Error(ERROR.INVALID_ENV(missingKeys.join()));
  }

  return {
    hostname: config.HOSTNAME || process.env.HOSTNAME!,
    mercuryBackendTestnet: "https://api.mercurydata.app",
    mercuryGraphQLTestnet: "https://api.mercurydata.app/graphql",
    mercuryBackendPubnet: "https://mainnet.mercurydata.app",
    mercuryGraphQLPubnet: "https://mainnet.mercurydata.app/graphql",
    mercuryGraphQLCurrentDataTestnet:
      "https://api.mercurydata.app:2096/graphql",
    mercuryGraphQLCurrentDataPubnet:
      "https://mainnet.mercurydata.app:2096/graphql",
    mercuryEmail: config.AUTH_EMAIL || process.env.AUTH_EMAIL!,
    mercuryPassword: config.AUTH_PASS || process.env.AUTH_PASS!,
    mercuryEmailTestnet:
      config.AUTH_EMAIL_TESTNET || process.env.AUTH_EMAIL_TESTNET!,
    mercuryPasswordTestnet:
      config.AUTH_PASS_TESTNET || process.env.AUTH_PASS_TESTNET!,
    mercuryKey: config.MERCURY_KEY || process.env.MERCURY_KEY!,
    mercuryUserId: config.MERCURY_USER_ID || process.env.MERCURY_USER_ID!,
    mercuryIntegrityCheckEmail:
      config.MERCURY_INTEGRITY_CHECK_ACCOUNT_EMAIL ||
      process.env.MERCURY_INTEGRITY_CHECK_ACCOUNT_EMAIL!,
    mercuryIntegrityCheckPass:
      config.MERCURY_INTEGRITY_CHECK_ACCOUNT_PASS ||
      process.env.MERCURY_INTEGRITY_CHECK_ACCOUNT_PASS!,
    mode: config.MODE || process.env.MODE!,
    redisConnectionName:
      config.REDIS_CONNECTION_NAME || process.env.REDIS_CONNECTION_NAME!,
    redisPort: Number(config.REDIS_PORT) || Number(process.env.REDIS_PORT!),
    useMercury:
      config.USE_MERCURY === "true" || process.env.USE_MERCURY === "true",
    useSorobanPublic: true,
  };
}

export type Conf = ReturnType<typeof buildConfig>;
