const ENV_KEYS = [
  "MERCURY_KEY",
  "MERCURY_BACKEND",
  "MERCURY_GRAPHQL",
  "MERCURY_USER_ID",
  "AUTH_EMAIL",
  "AUTH_PASS",
];

export function buildConfig(config: Record<string, string>) {
  Object.keys(config).forEach((key) => {
    if (!ENV_KEYS.includes(key)) {
      throw new Error(`ENV configuration invalid - missing ${key}`);
    }
  });

  return {
    mercuryEmail: config.AUTH_EMAIL,
    mercuryKey: config.MERCURY_KEY,
    mercuryPassword: config.AUTH_PASS,
    mercuryBackend: config.MERCURY_BACKEND,
    mercuryGraphQL: config.MERCURY_GRAPHQL,
    mercuryUserId: config.MERCURY_USER_ID,
  };
}

export type Conf = ReturnType<typeof buildConfig>;
