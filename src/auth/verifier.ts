import { createHash } from "crypto";
import { hash, Keypair } from "stellar-sdk";
import { isPubKey } from "../helper/validate";
import { ADDRESS_PROOF_REASON, VerifyAddressProofResult } from "./errors";

export const SIGN_MESSAGE_PREFIX = "Stellar Signed Message:\n";

export const canonicalizeJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`);
  return `{${entries.join(",")}}`;
};

export const sha256Hex = (data: string): string =>
  createHash("sha256").update(data, "utf8").digest("hex");

export const encodeSep53Message = (message: string): Buffer =>
  hash(
    Buffer.concat([
      Buffer.from(SIGN_MESSAGE_PREFIX, "utf8"),
      Buffer.from(message, "utf8"),
    ]),
  );

export const ADDRESS_PROOF_MAX_AGE_S = 15;
// Clock-skew leeway, matching freighter-backend-v2's ClockSkewLeeway (5s) so the
// two siblings accept the same drift; mobile clients especially can be off.
export const ADDRESS_PROOF_SKEW_S = 5;

// The request-body field the proof travels in. The proof is NOT an Authorization
// header: that header is reserved for v2's JWT, which an authenticated request
// carries alongside this proof.
export const ADDRESS_PROOF_BODY_FIELD = "address_proof";

// Domain separator folded into the signed bytes so an address proof cannot be
// produced via the generic SEP-53 signMessage dApp API (cross-protocol
// signature confusion). The clients' public signMessage path refuses to sign
// messages carrying this tag; only the internal signer emits it. Named
// generically (not per-endpoint): it lives in the signed bytes, so renaming it
// is a wire-breaking v2. Endpoints are separated by the `path` claim, not the tag.
export const ADDRESS_PROOF_DOMAIN = "freighter:address-proof:v1\n";

interface AddressProofClaims {
  sub: string;
  method: string;
  path: string;
  body_hash: string;
  exp: number;
}

export const verifyAddressProof = (params: {
  method: string;
  path: string;
  body: unknown;
  nowSeconds: number;
}): VerifyAddressProofResult => {
  const { method, path, body, nowSeconds } = params;

  // Split the request body into the proof token and the "business" body the
  // proof commits to. body_hash covers the business body only — the proof field
  // is removed first (the proof can't hash itself).
  const bodyObj: Record<string, unknown> =
    body !== null && typeof body === "object"
      ? (body as Record<string, unknown>)
      : {};
  const { [ADDRESS_PROOF_BODY_FIELD]: proofField, ...businessBody } = bodyObj;

  if (!proofField || typeof proofField !== "string") {
    return {
      ok: false,
      status: 401,
      reason: ADDRESS_PROOF_REASON.NO_TOKEN,
      error: "Missing address proof",
    };
  }
  const segments = proofField.split(".");
  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    return {
      ok: false,
      status: 401,
      reason: ADDRESS_PROOF_REASON.MALFORMED,
      error: "Malformed address proof",
    };
  }
  const [payloadB64, sigB64] = segments;

  let canonicalPayload: string;
  let parsed: unknown;
  try {
    canonicalPayload = Buffer.from(payloadB64, "base64url").toString("utf8");
    parsed = JSON.parse(canonicalPayload);
  } catch {
    return {
      ok: false,
      status: 401,
      reason: ADDRESS_PROOF_REASON.MALFORMED,
      error: "Malformed address proof",
    };
  }
  // Guard non-object payloads (e.g. `null`, a JSON array, or a bare
  // number/string) before reading claim fields — otherwise a client-controlled
  // payload like base64url("null") would throw on the property access below and
  // surface as a 500 instead of a 401.
  if (parsed === null || typeof parsed !== "object") {
    return {
      ok: false,
      status: 401,
      reason: ADDRESS_PROOF_REASON.MALFORMED,
      error: "Malformed address proof",
    };
  }
  const claims = parsed as AddressProofClaims;
  if (
    typeof claims.sub !== "string" ||
    typeof claims.method !== "string" ||
    typeof claims.path !== "string" ||
    typeof claims.body_hash !== "string" ||
    typeof claims.exp !== "number"
  ) {
    return {
      ok: false,
      status: 401,
      reason: ADDRESS_PROOF_REASON.MALFORMED,
      error: "Malformed address proof",
    };
  }

  // StrKey validation BEFORE any downstream (Coinbase) call.
  if (!isPubKey(claims.sub)) {
    return {
      ok: false,
      status: 400,
      reason: ADDRESS_PROOF_REASON.BAD_CLAIMS,
      error: "Invalid Stellar address",
    };
  }

  if (
    nowSeconds > claims.exp + ADDRESS_PROOF_SKEW_S ||
    claims.exp > nowSeconds + ADDRESS_PROOF_MAX_AGE_S + ADDRESS_PROOF_SKEW_S
  ) {
    return {
      ok: false,
      status: 401,
      reason: ADDRESS_PROOF_REASON.EXPIRED,
      error: "Expired address proof",
    };
  }

  if (claims.method !== method || claims.path !== path) {
    return {
      ok: false,
      status: 401,
      reason: ADDRESS_PROOF_REASON.BAD_CLAIMS,
      error: "Address proof does not match request",
    };
  }

  if (claims.body_hash !== sha256Hex(canonicalizeJson(businessBody))) {
    return {
      ok: false,
      status: 401,
      reason: ADDRESS_PROOF_REASON.BAD_CLAIMS,
      error: "Address proof does not match request body",
    };
  }

  let verified = false;
  try {
    const digest = encodeSep53Message(ADDRESS_PROOF_DOMAIN + canonicalPayload);
    verified = Keypair.fromPublicKey(claims.sub).verify(
      digest,
      Buffer.from(sigB64, "base64url"),
    );
  } catch {
    verified = false;
  }
  if (!verified) {
    return {
      ok: false,
      status: 401,
      reason: ADDRESS_PROOF_REASON.BAD_SIGNATURE,
      error: "Invalid address proof",
    };
  }

  return { ok: true, sub: claims.sub };
};
