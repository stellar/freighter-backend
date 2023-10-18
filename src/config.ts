
export function buildConfig(config: Record<string, string>) {
  if (!config.MERCURY_KEY) {
    throw new Error('ENV configuration invalid - missing MERCURY_KEY')
  }

  if (!config.MERCURY_URL) {
    throw new Error('ENV configuration invalid - missing MERCURY_URL')
  }

  if (!config.AUTH_EMAIL) {
    throw new Error('ENV configuration invalid - missing AUTH_EMAIL')
  }

  if (!config.AUTH_PASS) {
    throw new Error('ENV configuration invalid - missing AUTH_PASS')
  }

  return {
    mercuryKey: config.MERCURY_KEY,
    mercuryUrl: config.MERCURY_URL,
    mercuryEmail: config.AUTH_EMAIL,
    mercuryPassword: config.AUTH_PASS
  }
}

export type Conf = ReturnType<typeof buildConfig>