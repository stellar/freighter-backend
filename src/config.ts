const ENV_KEYS = [
  "AUTH_EMAIL",
  "AUTH_PASS",
  "HOSTNAME",
  "MERCURY_KEY",
  "MERCURY_USER_ID",
  "MODE",
  "REDIS_CONNECTION_NAME",
  "REDIS_PORT",
  "USE_MERCURY",
];

export function buildConfig(config: Record<string, string>) {
  Object.keys(config).forEach((key) => {
    if (!ENV_KEYS.includes(key)) {
      throw new Error(`ENV configuration invalid - missing ${key}`);
    }
  });

  return {
    hostname: config.HOSTNAME || process.env.HOSTNAME!,
    mercuryBackendTestnet: "https://api.mercurydata.app:8443",
    mercuryGraphQLTestnet: "https://api.mercurydata.app:2083/graphql",
    mercuryBackendPubnet: "https://mainnet.mercurydata.app:8443",
    mercuryGraphQLPubnet: "https://mainnet.mercurydata.app:2083/graphql",
    mercuryEmail: config.AUTH_EMAIL || process.env.AUTH_EMAIL!,
    mercuryKey: config.MERCURY_KEY || process.env.MERCURY_KEY!,
    mercuryPassword: config.AUTH_PASS || process.env.AUTH_PASS!,
    mercuryUserId: config.MERCURY_USER_ID || process.env.MERCURY_USER_ID!,
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
