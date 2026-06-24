# Onramp Auth Proof — Design

- **Ticket:** "Add Coinbase Onramp token auth gate" (private security ticket; tracked in `stellar/wallet-eng-monorepo`).
- **Sibling:** [stellar/freighter-backend-v2#112](https://github.com/stellar/freighter-backend-v2/pull/112) — the Go JWT auth middleware this mirrors. See its [design doc](https://github.com/stellar/freighter-backend-v2/blob/main/docs/design/2026-06-22-jwt-auth-middleware.md).
- **Date:** 2026-06-24
- **Status:** Implementing (PR #316)

## Summary

Add a per-request **Ed25519 proof-of-address-ownership** gate to `POST /api/v1/onramp/token`. The
caller presents a short-lived signed proof that they control the Stellar address the Coinbase Onramp
session will fund; the server verifies the signature against that address and uses it as the Coinbase
destination. Stateless — no accounts, sessions, DB lookups, or server-side secret.

This is the **sibling** of #112's JWT auth: same stateless self-asserted-identity model, same
`permissive`/`strict` rollout, same `{result,reason}` metric shape, same package decomposition. Two
deliberate divergences (below): the proof's `sub` is a Stellar `G…` strkey (it proves _address_
ownership and _is_ the destination), and the envelope is a **SEP-53 signed message**, not a Bearer
JWT. The envelope difference is **forced** by the shared signing clients — see §Divergences.

## Scope

In scope (this PR, backend only):

- A verifier package (`src/auth/`) that, given a Fastify request, returns the proven principal or a
  typed `{status, reason}` failure.
- A route-scoped preHandler factory (`onrampAuthPreHandler({ mode })`) applying the rollout policy.
- `ONRAMP_AUTH_MODE` config (`permissive`|`strict`, default `permissive`), validated at load.
- A `{result, reason}` auth metric.
- Gating the **existing** `/onramp/token` route: destination derived from the proven `sub`, the legacy
  caller-supplied `address` honored only on the permissive unsigned path.

Out of scope (separate work):

- Client signing — extension (software-key + Ledger `signMessage`) and mobile (separate PRs).
- The `permissive → strict` cutover (one config flip after client adoption).
- **Per-principal rate limiting** — considered and **dropped**: keying on the proven `sub` is
  sybil-bypassable (fresh keypair → fresh `sub`), so it adds no real security over the pre-existing
  per-IP limit. Aggregate quota protection, if needed, is a separate control.
- **CORS origin-restriction** — the actual fix for the browser-origin phishing vector (see Scope note).

## Scope note — what this does and does not close

This requires cryptographic proof of control over the destination and removes the anonymous,
arbitrary-destination minting path. It is an **authentication / identity layer**, not a turnkey
anti-phishing control. In particular it does **not** close the browser-origin phishing vector where an
attacker mints a session for _their own_ address through a victim's browser (the destination is one
the attacker legitimately controls, so a valid proof exists; `strict` mode doesn't change that).
Closing that requires restricting CORS to known Freighter origins so a third-party page can't read a
minted token — orthogonal to this design, tracked separately.

## Rollout model (why two modes)

Shipped clients send **no** proof today; updated clients will sign every request. We can't break old
clients, so gated endpoints transition through modes:

| Mode                                 | No `Authorization` header                       | Header present, valid                | Header present, invalid |
| ------------------------------------ | ----------------------------------------------- | ------------------------------------ | ----------------------- |
| **permissive** (transition, default) | pass (legacy `address` body path, no principal) | pass (+ proven `sub` as destination) | **401**                 |
| **strict** (post-rollout)            | **401**                                         | pass (+ proven `sub`)                | **401**                 |

A present-but-invalid proof is **always** rejected (401) in both modes — only updated clients send
proofs, so a bad one is a bug or attack. The mode is a single global config value; the cutover is one
config change once the `{result="anonymous"}` series falls to ~0.

> Note the permissive row differs from #112: onramp pre-existed with a caller-supplied `address` body
> field, so the unsigned path stays functional (legacy) during the window. #112's endpoint was net-new
> and simply goes anonymous.

## Architecture

```
src/auth/                  NEW — pure verifier primitive + policy, mirrors v2 internal/auth/
  mode.ts        AuthMode + parseMode ("permissive"|"strict"; ""→permissive; unknown→throw)
  errors.ts      ONRAMP_AUTH_REASON taxonomy + VerifyOnrampProofResult type
  verifier.ts    canonicalizeJson, sha256Hex, encodeSep53Message, ONRAMP_AUTH_DOMAIN, verifyOnrampProof
  context.ts     Fastify module augmentation + request.onrampPrincipal (via decorateRequest)
  middleware.ts  onrampAuthPreHandler({ mode }) — verify → mode policy → metric → stash principal
  *.test.ts      table-driven unit tests + a test-only proof minter (makeOnrampProof)

src/route/index.ts         /onramp/token: preHandler = onrampAuthPreHandler; destination = principal
src/config.ts              + onrampAuthMode (parseMode-validated at load)
src/helper/metrics.ts      + freighter_backend_onramp_auth_requests_total{result,reason} + recordOnrampAuth
```

**Boundaries:** `verifier.ts` owns the _mechanism_ (is this proof cryptographically valid for the
claimed address?). `middleware.ts` owns the _policy_ (mode, per-outcome action, metric, principal
stashing). Config owns mode selection.

## The proof — wire contract (porting-critical; reproduce byte-for-byte)

**Header:** `Authorization: Stellar <base64url(canonicalClaims)>.<base64url(signature)>`

- scheme literal `Stellar`; `base64url` is **unpadded** (RFC 4648 §5, no `=`).

**Claims** (the object that is canonicalized then signed):

```jsonc
{ "sub": "G…", "method": "POST", "path": "/api/v1/onramp/token", "body_hash": "<hex>", "exp": <int> }
```

- `sub` — the signer's Stellar strkey public key; **is** the Coinbase destination.
- `body_hash` — `sha256_hex(canonicalizeJson(requestBody))`; the body is `{}` for current clients.
- `exp` — unix **seconds**, an **integer**, set to `now + 15`.

**Signed bytes (the critical part):**

```
signedMessage = ONRAMP_AUTH_DOMAIN + canonicalizeJson(claims)
digest        = SHA256( "Stellar Signed Message:\n"  ++  signedMessage )      // SEP-53 framing
signature     = Ed25519_sign(digest, signerSecretKey)
```

- `ONRAMP_AUTH_DOMAIN = "freighter:onramp-auth:v1\n"` (a constant, **not transmitted**; bytes include
  the trailing `\n` = 0x0A). It is a versioned domain separator — see §Cross-protocol hardening.
- The SEP-53 prefix `"Stellar Signed Message:\n"` is the same one the clients' generic message signer
  uses; the domain tag is what distinguishes an onramp proof from an arbitrary signed message.

**`canonicalizeJson`** — deterministic JSON: object keys sorted ascending, no whitespace, arrays in
order, primitives via `JSON.stringify` semantics. Reference implementation:

```ts
const canonicalizeJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const entries = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`);
  return `{${entries.join(",")}}`;
};
```

**Verification order** (`verifyOnrampProof`), each failure mapped to `{status, reason}`:

1. No `Authorization` → `401 no_token` (anonymous-eligible in permissive).
2. Bad scheme / not two dot-segments / base64url or JSON parse failure / wrong claim field types →
   `401 malformed`.
3. `sub` not a valid Ed25519 strkey → **`400 bad_claims`**, _before any Coinbase call_.
4. Expiry window: reject if `now > exp + 2` (expired) or `exp > now + 15 + 2` (too far future) →
   `401 expired`. (≤15s lifetime, 2s skew.)
5. `method` / `path` mismatch vs the actual request → `401 bad_claims`.
6. `body_hash != sha256_hex(canonicalizeJson(body))` → `401 bad_claims`.
7. `Ed25519_verify(digest, signature, sub)` fails → `401 bad_signature`.
   - The digest is recomputed over `ONRAMP_AUTH_DOMAIN + receivedCanonicalPayloadBytes` — i.e. the
     bytes as received, not a re-canonicalization.
8. Success → principal = `sub`.

## Divergences from #112 (intended)

1. **`sub`** is a Stellar `G…` strkey (proves address ownership, and _is_ the destination), not a hex
   Ed25519 user ID. Validate via strkey decode, not raw hex.
2. **Envelope** is a SEP-53 signed message, not a Bearer JWT. _Forced:_ the onramp clients include
   **Ledger hardware wallets**, whose on-device signer produces SEP-53 message signatures, not
   raw JWT-signing-input signatures — a pure EdDSA JWT can't be produced on a Ledger. So the format is
   dictated by the shared clients, not the backend.
3. Claims carry `method` + `path` separately (vs #112's combined `methodAndPath`); no `iat` (the
   server bounds lifetime via the `exp ≤ now+15+skew` check rather than `exp-iat`).
4. Coarser reason set (no body/timing-specific reasons).

## Cross-protocol hardening

The onramp proof reuses the SEP-53 primitive that the clients' public `signMessage` dApp API also
exposes. Without separation, a connected dApp could get a user to sign the bare claims and forge a
proof (bounded — only mints for the user's _own_ address; no fund redirection). The
`ONRAMP_AUTH_DOMAIN` tag, folded into the signed bytes and required by the verifier, makes onramp
proofs recognizable and distinct. The **load-bearing** half is client-side: the public `signMessage`
path must refuse to sign any message beginning with the tag, so proofs can only originate from the
internal onramp signer (lands with the client PRs).

## Porting to freighter-backend-v2 (Go)

When v2 grows an onramp endpoint, this gate ports to Go. **The clients are shared and sign SEP-53, so
v2's onramp verifier MUST accept this exact SEP-53 proof — it cannot reuse #112's Bearer-JWT verifier.
v2 will have two auth schemes: JWT for user-id auth, and this SEP-53 onramp proof.** Reuse v2's
`Mode`, `context`, metric, and reason vocabulary; add a _new_ SEP-53 onramp verifier alongside the JWT one.

File mapping:

| v1 (TS)                  | v2 (Go)                                                                     |
| ------------------------ | --------------------------------------------------------------------------- |
| `src/auth/mode.ts`       | reuse existing `internal/auth/mode.go` (values already match)               |
| `src/auth/errors.ts`     | reuse/extend `internal/auth/errors.go` reasons                              |
| `src/auth/context.ts`    | reuse `internal/auth/context.go` (stash the principal)                      |
| `src/auth/verifier.ts`   | **new** `internal/auth/onramp_verifier.go` (distinct from the JWT verifier) |
| `src/auth/middleware.ts` | new onramp branch in `internal/api/middleware`                              |
| `src/helper/metrics.ts`  | reuse the `{result,reason}` auth counter                                    |

**Cross-language landmines (where Go silently diverges) — the canonicalization must be byte-identical:**

- **HTML escaping:** JS `JSON.stringify` leaves `<` `>` `&` raw; Go's `encoding/json` escapes them to
  `<` etc. **by default**. Go MUST `json.Encoder.SetEscapeHTML(false)` (or build the canonical
  string manually).
- **`exp` is an integer** (unix seconds), never a float — integer marshaling matches; floats wouldn't.
- **ASCII-only invariant:** every canonicalized field today (`sub` strkey `[A-Z2-7]`, `"POST"`, the
  path, hex `body_hash`, integer `exp`) is ASCII, so key-sort order and string escaping are
  unambiguous across languages. Preserve this invariant if fields are ever added.
- **Exact bytes:** `ONRAMP_AUTH_DOMAIN = "freighter:onramp-auth:v1\n"` and SEP-53 prefix
  `"Stellar Signed Message:\n"` both include a trailing `\n` (0x0A). `base64url` is **unpadded**.
- **Crypto:** SHA-256; Ed25519 verify (`crypto/ed25519`); decode `sub` with `stellar/go`'s `strkey`
  (`strkey.Decode(strkey.VersionByteAccountID, sub)` → 32-byte pubkey).
- Verify over the **received** canonical bytes, not a re-canonicalization (defensive parity with v1).

The `ONRAMP_AUTH_DOMAIN` carries a `v1` version; any future protocol change bumps it in lockstep
across the TS verifier, the Go verifier, and all client signers.

## Observability

- Metric `freighter_backend_onramp_auth_requests_total{result, reason}` (sibling of v2's
  `freighter_auth_requests_total`).
  - `result ∈ {authenticated, anonymous, rejected}` — rollout-adoption signal.
  - `reason ∈ {ok, no_token, expired, bad_signature, bad_claims, malformed}` — fixed categories
    (never a request value), so rejection spikes triage by cause without label-cardinality risk.
- Each mint logs the principal + destination (a public address) and `authMode`; never secret material
  or signature bytes.

## Testing

- **verifier unit tests** (table-driven) with a test-only minter (`makeOnrampProof`): valid; missing;
  malformed (scheme/dots/base64/json/types); invalid strkey → 400; expired-past / too-far-future / ±2s
  skew boundary; method/path mismatch; body tamper; wrong-key → bad_signature; **untagged signature
  (generic SEP-53) → bad_signature** (the cross-protocol regression).
- **route tests:** signed mint uses the proven `sub` (ignores body `address`); permissive unsigned →
  200 (legacy path); present-but-invalid → 401; strict unsigned → 401 (the ticket repro); strict valid
  StrKey-but-bad → 400.

## Operational notes

- New env/config var: `ONRAMP_AUTH_MODE` (default `permissive`).
- New metric: `freighter_backend_onramp_auth_requests_total`.
- New auth-proof error strings on `/onramp/token` (401/400).
- Reflected in `wallet-eng-runbooks` (onramp-token runbook), handled via the runbook reconcile step.
