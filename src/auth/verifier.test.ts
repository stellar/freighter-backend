import {
  canonicalizeJson,
  sha256Hex,
  encodeSep53Message,
  SIGN_MESSAGE_PREFIX,
  ADDRESS_PROOF_DOMAIN,
  ADDRESS_PROOF_BODY_FIELD,
  verifyAddressProof,
} from "./verifier";
import { hash, Keypair } from "stellar-sdk";
import { ADDRESS_PROOF_REASON } from "./errors";

describe("address-proof primitives", () => {
  it("canonicalizes objects with sorted keys and no whitespace", () => {
    expect(canonicalizeJson({ b: 1, a: "x" })).toEqual('{"a":"x","b":1}');
    expect(canonicalizeJson({})).toEqual("{}");
    expect(canonicalizeJson({ z: { y: 2, x: 1 } })).toEqual(
      '{"z":{"x":1,"y":2}}',
    );
  });

  it("sha256Hex matches a known vector", () => {
    // echo -n '{}' | shasum -a 256
    expect(sha256Hex("{}")).toEqual(
      "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    );
  });

  it("encodeSep53Message hashes the prefixed message", () => {
    const msg = '{"a":1}';
    const expected = hash(
      Buffer.concat([
        Buffer.from(SIGN_MESSAGE_PREFIX, "utf8"),
        Buffer.from(msg, "utf8"),
      ]),
    );
    expect(encodeSep53Message(msg).equals(expected)).toBe(true);
  });
});

const PATH = "/api/v1/onramp/token";
const NOW = 1_700_000_000;
const b64url = (s: string | Buffer) =>
  (typeof s === "string" ? Buffer.from(s, "utf8") : s).toString("base64url");

// Mints a proof and returns the full request body carrying it in the
// `address_proof` field. body_hash commits to `businessBody` (the request body
// WITHOUT the proof field), matching the verifier's carve-out.
const mintProof = (
  kp: Keypair,
  overrides: Partial<{
    method: string;
    path: string;
    body: Record<string, unknown>;
    exp: number;
    sub: string;
  }> = {},
) => {
  const businessBody = overrides.body ?? {};
  const claims = {
    sub: overrides.sub ?? kp.publicKey(),
    method: overrides.method ?? "POST",
    path: overrides.path ?? PATH,
    body_hash: sha256Hex(canonicalizeJson(businessBody)),
    exp: overrides.exp ?? NOW + 15,
  };
  const canonical = canonicalizeJson(claims);
  const sig = kp.sign(encodeSep53Message(ADDRESS_PROOF_DOMAIN + canonical));
  const token = `${b64url(canonical)}.${b64url(sig)}`;
  const body = { ...businessBody, [ADDRESS_PROOF_BODY_FIELD]: token };
  return { token, body, businessBody };
};

describe("verifyAddressProof", () => {
  const kp = Keypair.random();
  const base = { method: "POST", path: PATH, nowSeconds: NOW };

  it("accepts a valid proof and returns the principal", () => {
    const { body } = mintProof(kp);
    expect(verifyAddressProof({ ...base, body })).toEqual({
      ok: true,
      sub: kp.publicKey(),
    });
  });

  it("401 NO_TOKEN when the proof field is absent (anonymous-eligible)", () => {
    expect(verifyAddressProof({ ...base, body: {} })).toMatchObject({
      ok: false,
      status: 401,
      reason: ADDRESS_PROOF_REASON.NO_TOKEN,
    });
  });

  it("401 MALFORMED (not NO_TOKEN) when the proof field is present but empty", () => {
    // Present-but-invalid must NOT fall through to the permissive anonymous
    // path — an empty `address_proof` alongside a legacy `address` must still
    // be rejected in both modes.
    expect(
      verifyAddressProof({
        ...base,
        body: { address_proof: "", address: "GABC" },
      }),
    ).toMatchObject({
      ok: false,
      status: 401,
      reason: ADDRESS_PROOF_REASON.MALFORMED,
    });
  });

  it("401 MALFORMED when the proof field is present but a non-string", () => {
    expect(
      verifyAddressProof({
        ...base,
        body: { address_proof: 123 } as unknown as Record<string, unknown>,
      }),
    ).toMatchObject({
      ok: false,
      status: 401,
      reason: ADDRESS_PROOF_REASON.MALFORMED,
    });
  });

  it("401 on a malformed proof token", () => {
    // one segment
    expect(
      verifyAddressProof({ ...base, body: { address_proof: "nodot" } }),
    ).toMatchObject({
      ok: false,
      status: 401,
      reason: ADDRESS_PROOF_REASON.MALFORMED,
    });
    // three segments
    expect(
      verifyAddressProof({ ...base, body: { address_proof: "a.b.c" } }),
    ).toMatchObject({
      ok: false,
      status: 401,
      reason: ADDRESS_PROOF_REASON.MALFORMED,
    });
  });

  it("401 (not 500) on a non-object JSON payload", () => {
    // Payload decodes to valid JSON that is not an object — `null`, an array,
    // and a bare number. Each must yield a clean MALFORMED 401 rather than
    // throwing on the claim-field access.
    for (const payload of ["null", "[]", "123"]) {
      const token = `${b64url(payload)}.${b64url("sig")}`;
      expect(
        verifyAddressProof({ ...base, body: { address_proof: token } }),
      ).toMatchObject({
        ok: false,
        status: 401,
        reason: ADDRESS_PROOF_REASON.MALFORMED,
      });
    }
  });

  it("400 on invalid StrKey sub", () => {
    const { body } = mintProof(kp, { sub: "not-a-key" });
    expect(verifyAddressProof({ ...base, body })).toMatchObject({
      ok: false,
      status: 400,
      reason: ADDRESS_PROOF_REASON.BAD_CLAIMS,
    });
  });

  it("401 when expired (past window + skew)", () => {
    // 6s in the past — beyond the 5s skew leeway.
    const { body } = mintProof(kp, { exp: NOW - 6 });
    expect(verifyAddressProof({ ...base, body })).toMatchObject({
      ok: false,
      status: 401,
      reason: ADDRESS_PROOF_REASON.EXPIRED,
    });
  });

  it("accepts within 5s backward skew", () => {
    const { body } = mintProof(kp, { exp: NOW - 5 });
    expect(verifyAddressProof({ ...base, body }).ok).toBe(true);
  });

  it("401 when exp too far in future", () => {
    const { body } = mintProof(kp, { exp: NOW + 100 });
    expect(verifyAddressProof({ ...base, body })).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("401 on method/path mismatch", () => {
    const { body } = mintProof(kp);
    expect(verifyAddressProof({ ...base, body, method: "GET" })).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(verifyAddressProof({ ...base, body, path: "/other" })).toMatchObject(
      { ok: false, status: 401 },
    );
  });

  it("401 on body tampering", () => {
    const { body } = mintProof(kp, { body: {} });
    // Add a field not covered by the signed body_hash.
    expect(
      verifyAddressProof({ ...base, body: { ...body, evil: 1 } }),
    ).toMatchObject({ ok: false, status: 401 });
  });

  it("401 when signed by a different key", () => {
    const attacker = Keypair.random();
    const { body } = mintProof(attacker, { sub: kp.publicKey() });
    expect(verifyAddressProof({ ...base, body })).toMatchObject({
      ok: false,
      status: 401,
      reason: ADDRESS_PROOF_REASON.BAD_SIGNATURE,
    });
  });

  it("rejects a proof whose signature does not cover the address-proof domain tag (cross-protocol confusion)", () => {
    const kp2 = Keypair.random();
    const claims = {
      sub: kp2.publicKey(),
      method: "POST",
      path: PATH,
      body_hash: sha256Hex(canonicalizeJson({})),
      exp: NOW + 15,
    };
    const canonical = canonicalizeJson(claims);
    // Signed WITHOUT ADDRESS_PROOF_DOMAIN — i.e. a generic SEP-53 message signature.
    const sig = kp2.sign(encodeSep53Message(canonical));
    const token = `${b64url(canonical)}.${b64url(sig)}`;
    expect(
      verifyAddressProof({
        method: "POST",
        path: PATH,
        body: { address_proof: token },
        nowSeconds: NOW,
      }),
    ).toMatchObject({
      ok: false,
      status: 401,
      reason: ADDRESS_PROOF_REASON.BAD_SIGNATURE,
    });
  });
});
