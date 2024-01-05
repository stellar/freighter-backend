const ENV_KEYS = [
  "AUTH_EMAIL",
  "AUTH_PASS",
  "HOSTNAME",
  "MERCURY_BACKEND",
  "MERCURY_GRAPHQL",
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
    mercuryBackend: config.MERCURY_BACKEND || process.env.MERCURY_BACKEND!,
    mercuryEmail: config.AUTH_EMAIL || process.env.AUTH_EMAIL!,
    mercuryGraphQL: config.MERCURY_GRAPHQL || process.env.MERCURY_GRAPHQL!,
    mercuryKey: config.MERCURY_KEY || process.env.MERCURY_KEY!,
    mercuryPassword: config.AUTH_PASS || process.env.AUTH_PASS!,
    mercuryUserId: config.MERCURY_USER_ID || process.env.MERCURY_USER_ID!,
    mode: config.MODE || process.env.MODE!,
    redisConnectionName:
      config.REDIS_CONNECTION_NAME || process.env.REDIS_CONNECTION_NAME!,
    redisPort: Number(config.REDIS_PORT) || Number(process.env.REDIS_PORT!),
    useMercury: config.USE_MERCURY || process.env.USE_MERCURY!,
  };
}

export type Conf = ReturnType<typeof buildConfig>;
