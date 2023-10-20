export function buildConfig(config: Record<string, string>) {
  if (!config.MERCURY_KEY) {
    throw new Error("ENV configuration invalid - missing MERCURY_KEY");
  }

  if (!config.MERCURY_URL) {
    throw new Error("ENV configuration invalid - missing MERCURY_URL");
  }

  if (!config.AUTH_EMAIL) {
    throw new Error("ENV configuration invalid - missing AUTH_EMAIL");
  }

  if (!config.AUTH_PASS) {
    throw new Error("ENV configuration invalid - missing AUTH_PASS");
  }

  if (!config.MERCURY_USER_ID) {
    throw new Error("ENV configuration invalid - missing MERCURY_USER_ID");
  }

  return {
    mercuryEmail: config.AUTH_EMAIL,
    mercuryKey: config.MERCURY_KEY,
    mercuryPassword: config.AUTH_PASS,
    mercuryUrl: config.MERCURY_URL,
    mercuryUserId: config.MERCURY_USER_ID,
  };
}

export type Conf = ReturnType<typeof buildConfig>;
