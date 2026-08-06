// Mirrors freighter-backend-v2 internal/auth/errors.go reason constants.
export const ADDRESS_PROOF_REASON = {
  OK: "ok", // success marker for the authenticated result (mirrors backend-v2)
  NO_TOKEN: "no_token",
  EXPIRED: "expired",
  BAD_SIGNATURE: "bad_signature",
  BAD_CLAIMS: "bad_claims",
  MALFORMED: "malformed",
} as const;

export type AddressProofReason =
  (typeof ADDRESS_PROOF_REASON)[keyof typeof ADDRESS_PROOF_REASON];

export type VerifyAddressProofResult =
  | { ok: true; sub: string }
  | { ok: false; status: 400 | 401; reason: AddressProofReason; error: string };
