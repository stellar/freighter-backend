import { createHash } from "crypto";
import { hash, Keypair } from "stellar-sdk";
import { isPubKey } from "../helper/validate";
import { ONRAMP_AUTH_REASON, VerifyOnrampProofResult } from "./errors";

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

export const ONRAMP_PROOF_SCHEME = "Stellar";
export const ONRAMP_PROOF_MAX_AGE_S = 15;
export const ONRAMP_PROOF_SKEW_S = 2;

// Domain separator folded into the signed bytes so an onramp proof cannot be
// produced via the generic SEP-53 signMessage dApp API (cross-protocol
// signature confusion). The clients' public signMessage path refuses to sign
// messages carrying this tag; only the internal onramp signer emits it.
export const ONRAMP_AUTH_DOMAIN = "freighter:onramp-auth:v1\n";

interface OnrampProofClaims {
  sub: string;
  method: string;
  path: string;
  body_hash: string;
  exp: number;
}

export const verifyOnrampProof = (params: {
  authorization?: string;
  method: string;
  path: string;
  body: unknown;
  nowSeconds: number;
}): VerifyOnrampProofResult => {
  const { authorization, method, path, body, nowSeconds } = params;

  if (!authorization) {
    return {
      ok: false,
      status: 401,
      reason: ONRAMP_AUTH_REASON.NO_TOKEN,
      error: "Missing onramp authorization proof",
    };
  }
  const [scheme, token] = authorization.split(" ");
  if (
    scheme !== ONRAMP_PROOF_SCHEME ||
    !token ||
    token.split(".").length !== 2
  ) {
    return {
      ok: false,
      status: 401,
      reason: ONRAMP_AUTH_REASON.MALFORMED,
      error: "Malformed onramp authorization proof",
    };
  }
  const [payloadB64, sigB64] = token.split(".");

  let canonicalPayload: string;
  let claims: OnrampProofClaims;
  try {
    canonicalPayload = Buffer.from(payloadB64, "base64url").toString("utf8");
    claims = JSON.parse(canonicalPayload);
  } catch {
    return {
      ok: false,
      status: 401,
      reason: ONRAMP_AUTH_REASON.MALFORMED,
      error: "Malformed onramp authorization proof",
    };
  }
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
      reason: ONRAMP_AUTH_REASON.MALFORMED,
      error: "Malformed onramp authorization proof",
    };
  }

  // StrKey validation BEFORE any downstream (Coinbase) call.
  if (!isPubKey(claims.sub)) {
    return {
      ok: false,
      status: 400,
      reason: ONRAMP_AUTH_REASON.BAD_CLAIMS,
      error: "Invalid Stellar address",
    };
  }

  if (
    nowSeconds > claims.exp + ONRAMP_PROOF_SKEW_S ||
    claims.exp > nowSeconds + ONRAMP_PROOF_MAX_AGE_S + ONRAMP_PROOF_SKEW_S
  ) {
    return {
      ok: false,
      status: 401,
      reason: ONRAMP_AUTH_REASON.EXPIRED,
      error: "Expired onramp authorization proof",
    };
  }

  if (claims.method !== method || claims.path !== path) {
    return {
      ok: false,
      status: 401,
      reason: ONRAMP_AUTH_REASON.BAD_CLAIMS,
      error: "Onramp proof does not match request",
    };
  }

  if (claims.body_hash !== sha256Hex(canonicalizeJson(body ?? {}))) {
    return {
      ok: false,
      status: 401,
      reason: ONRAMP_AUTH_REASON.BAD_CLAIMS,
      error: "Onramp proof does not match request body",
    };
  }

  let verified = false;
  try {
    const digest = encodeSep53Message(ONRAMP_AUTH_DOMAIN + canonicalPayload);
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
      reason: ONRAMP_AUTH_REASON.BAD_SIGNATURE,
      error: "Invalid onramp authorization proof",
    };
  }

  return { ok: true, sub: claims.sub };
};
