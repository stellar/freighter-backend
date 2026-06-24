// Mirrors freighter-backend-v2 internal/auth/errors.go reason constants.
export const ONRAMP_AUTH_REASON = {
  OK: "ok", // success marker for the authenticated result (mirrors backend-v2)
  NO_TOKEN: "no_token",
  EXPIRED: "expired",
  BAD_SIGNATURE: "bad_signature",
  BAD_CLAIMS: "bad_claims",
  MALFORMED: "malformed",
  RATE_LIMITED: "rate_limited", // onramp-specific extension (no Go equivalent)
} as const;

export type OnrampAuthReason =
  (typeof ONRAMP_AUTH_REASON)[keyof typeof ONRAMP_AUTH_REASON];

export type VerifyOnrampProofResult =
  | { ok: true; sub: string }
  | { ok: false; status: 400 | 401; reason: OnrampAuthReason; error: string };
