import {
  canonicalizeJson,
  sha256Hex,
  encodeSep53Message,
  SIGN_MESSAGE_PREFIX,
} from "./onramp-auth";
import { hash, Keypair } from "stellar-sdk";
import { verifyOnrampProof } from "./onramp-auth";

describe("onramp-auth primitives", () => {
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

const mintProof = (
  kp: Keypair,
  overrides: Partial<{
    method: string;
    path: string;
    body: unknown;
    exp: number;
    sub: string;
  }> = {},
) => {
  const body = overrides.body ?? {};
  const claims = {
    sub: overrides.sub ?? kp.publicKey(),
    method: overrides.method ?? "POST",
    path: overrides.path ?? PATH,
    body_hash: sha256Hex(canonicalizeJson(body)),
    exp: overrides.exp ?? NOW + 15,
  };
  const canonical = canonicalizeJson(claims);
  const sig = kp.sign(encodeSep53Message(canonical));
  const header = `Stellar ${Buffer.from(canonical, "utf8").toString(
    "base64url",
  )}.${sig.toString("base64url")}`;
  return { header, body };
};

describe("verifyOnrampProof", () => {
  const kp = Keypair.random();
  const base = { method: "POST", path: PATH, body: {}, nowSeconds: NOW };

  it("accepts a valid proof and returns the principal", () => {
    const { header, body } = mintProof(kp);
    expect(verifyOnrampProof({ ...base, authorization: header, body })).toEqual(
      {
        ok: true,
        sub: kp.publicKey(),
      },
    );
  });

  it("401 when header missing", () => {
    expect(
      verifyOnrampProof({ ...base, authorization: undefined }),
    ).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("401 on malformed header", () => {
    expect(
      verifyOnrampProof({ ...base, authorization: "Bearer xyz" }),
    ).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(
      verifyOnrampProof({ ...base, authorization: "Stellar nodot" }),
    ).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("400 on invalid StrKey sub", () => {
    const { header, body } = mintProof(kp, { sub: "not-a-key" });
    expect(
      verifyOnrampProof({ ...base, authorization: header, body }),
    ).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("401 when expired (past window + skew)", () => {
    const { header, body } = mintProof(kp, { exp: NOW - 3 });
    expect(
      verifyOnrampProof({ ...base, authorization: header, body }),
    ).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("accepts within 2s backward skew", () => {
    const { header, body } = mintProof(kp, { exp: NOW - 2 });
    expect(verifyOnrampProof({ ...base, authorization: header, body }).ok).toBe(
      true,
    );
  });

  it("401 when exp too far in future", () => {
    const { header, body } = mintProof(kp, { exp: NOW + 100 });
    expect(
      verifyOnrampProof({ ...base, authorization: header, body }),
    ).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it("401 on method/path mismatch", () => {
    const { header, body } = mintProof(kp);
    expect(
      verifyOnrampProof({
        ...base,
        authorization: header,
        body,
        method: "GET",
      }),
    ).toMatchObject({ ok: false, status: 401 });
    expect(
      verifyOnrampProof({
        ...base,
        authorization: header,
        body,
        path: "/other",
      }),
    ).toMatchObject({ ok: false, status: 401 });
  });

  it("401 on body tampering", () => {
    const { header } = mintProof(kp, { body: {} });
    expect(
      verifyOnrampProof({ ...base, authorization: header, body: { evil: 1 } }),
    ).toMatchObject({ ok: false, status: 401 });
  });

  it("401 when signed by a different key", () => {
    const attacker = Keypair.random();
    const { header, body } = mintProof(attacker, { sub: kp.publicKey() });
    expect(
      verifyOnrampProof({ ...base, authorization: header, body }),
    ).toMatchObject({
      ok: false,
      status: 401,
    });
  });
});

import {
  enforcePrincipalRateLimit,
  ONRAMP_PRINCIPAL_RATE_LIMIT,
} from "./onramp-auth";

describe("enforcePrincipalRateLimit", () => {
  const sub = "GABC";

  it("allows and sets TTL on first hit", async () => {
    const redis = {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    };
    const ok = await enforcePrincipalRateLimit(redis as any, sub);
    expect(ok).toBe(true);
    expect(redis.incr).toHaveBeenCalledWith(`onramp:rl:${sub}`);
    expect(redis.expire).toHaveBeenCalledWith(`onramp:rl:${sub}`, 60);
  });

  it("blocks once over the limit", async () => {
    const redis = {
      incr: jest.fn().mockResolvedValue(ONRAMP_PRINCIPAL_RATE_LIMIT + 1),
      expire: jest.fn(),
    };
    expect(await enforcePrincipalRateLimit(redis as any, sub)).toBe(false);
  });

  it("allows when redis is undefined (dev/test)", async () => {
    expect(await enforcePrincipalRateLimit(undefined, sub)).toBe(true);
  });
});
