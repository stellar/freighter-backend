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
];

export function buildConfig(config: Record<string, string>) {
  Object.keys(config).forEach((key) => {
    if (!ENV_KEYS.includes(key)) {
      throw new Error(`ENV configuration invalid - missing ${key}`);
    }
  });

  return {
    hostname: config.HOSTNAME,
    mercuryBackend: config.MERCURY_BACKEND,
    mercuryEmail: config.AUTH_EMAIL,
    mercuryGraphQL: config.MERCURY_GRAPHQL,
    mercuryKey: config.MERCURY_KEY,
    mercuryPassword: config.AUTH_PASS,
    mercuryUserId: config.MERCURY_USER_ID,
    mode: config.MODE,
    redisConnectionName: config.REDIS_CONNECTION_NAME,
    redisPort: Number(config.REDIS_PORT),
  };
}

export type Conf = ReturnType<typeof buildConfig>;
