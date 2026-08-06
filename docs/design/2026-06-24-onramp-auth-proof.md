# Onramp Auth — Address-Proof Design

- **Ticket:** "Add Coinbase Onramp token auth gate" (private security ticket; tracked in `stellar/wallet-eng-monorepo`).
- **Sibling:** [stellar/freighter-backend-v2#112](https://github.com/stellar/freighter-backend-v2/pull/112) — the Go JWT auth middleware this mirrors. See its [design doc](https://github.com/stellar/freighter-backend-v2/blob/main/docs/design/2026-06-22-jwt-auth-middleware.md).
- **Date:** 2026-06-24 (revised 2026-07-07: address-proof generalization; proof moved to request body; 5s skew).
- **Status:** Implementing (PR #316)

## Summary

Add a per-request **Ed25519 proof-of-address-ownership** gate to `POST /api/v1/onramp/token`. The
caller presents a short-lived signed proof that they control the Stellar address the Coinbase Onramp
session will fund; the server verifies the signature against that address and uses it as the Coinbase
destination. Stateless — no accounts, sessions, DB lookups, or server-side secret.

The proof is a **reusable primitive, not an onramp-specific one.** This PR ships it as the
`address-proof` gate in `src/auth/`, with `/onramp/token` as its **first consumer**. Any future
endpoint that must act on a Stellar address the caller controls reuses the same verifier — see
§Reusing the address proof.

**Two layers, kept separate (this is the load-bearing design decision).** Freighter authentication
splits into two orthogonal concerns:

- **Authentication — _who is calling_** — the JWT from #112 (`Authorization: Bearer`), a horizontal
  concern applied uniformly by middleware to any endpoint that needs a real caller. `sub` is a
  self-asserted hex Ed25519 user-id (a client-derived auth key, _not_ an on-chain account).
- **Address ownership — _which address they control_** — this address proof, a vertical, per-endpoint
  capability assertion carried **in the request body**. `sub` is the `G…` strkey being acted on.

These co-occur (an authenticated onramp request in v2 needs both) and cannot share the single
`Authorization` header, so the address proof lives in the body. See §Divergences and §Porting.

## Scope

In scope (this PR, backend only):

- A reusable verifier package (`src/auth/`) that, given a Fastify request, returns the proven
  address (principal) or a typed `{status, reason}` failure — **endpoint-agnostic** (scoped by the
  proof's `method`/`path` claims).
- A route-scoped preHandler factory (`onrampAuthPreHandler({ mode })`) applying the rollout policy —
  the onramp consumer's glue over the generic verifier.
- `ONRAMP_AUTH_MODE` config (`permissive`|`strict`, default `permissive`), validated at load.
- A `{result, reason}` auth metric.
- Gating the **existing** `/onramp/token` route: destination derived from the proven `sub`, the legacy
  caller-supplied `address` honored only on the permissive unsigned path.

Out of scope (separate work):

- Client signing — extension (software-key + Ledger `signMessage`) and mobile (separate PRs). **The
  client PRs must send the proof as the `address_proof` body field, not an `Authorization` header (see
  §Wire contract) — this is a change from the earlier header-based draft.**
- The `permissive → strict` cutover (one config flip after client adoption).
- **Per-principal rate limiting** — considered and **dropped**: keying on the proven `sub` is
  sybil-bypassable (fresh keypair → fresh `sub`), so it adds no real security over the pre-existing
  per-IP limit. Aggregate quota protection, if needed, is a separate control.
- Additional endpoint hardening, tracked separately in the private security ticket.

## Rollout model (why two modes)

Shipped clients send **no** proof today; updated clients will sign every request. We can't break old
clients, so gated endpoints transition through modes:

| Mode                                 | No `address_proof` in body                      | Proof present, valid                 | Proof present, invalid |
| ------------------------------------ | ----------------------------------------------- | ------------------------------------ | ---------------------- |
| **permissive** (transition, default) | pass (legacy `address` body path, no principal) | pass (+ proven `sub` as destination) | **401**                |
| **strict** (post-rollout)            | **401**                                         | pass (+ proven `sub`)                | **401**                |

A present-but-invalid proof is **always** rejected (401) in both modes — only updated clients send
proofs, so a bad one is a bug or attack. The mode is a single global config value; the cutover is one
config change once the `{result="anonymous"}` series falls to ~0.

> Note the permissive row differs from #112: onramp pre-existed with a caller-supplied `address` body
> field, so the unsigned path stays functional (legacy) during the window. #112's endpoint was net-new
> and simply goes anonymous.

## Architecture

```
src/auth/                  NEW — reusable address-proof primitive + onramp policy, mirrors v2 internal/auth/
  mode.ts        AuthMode + parseMode ("permissive"|"strict"; ""→permissive; unknown→throw)
  errors.ts      ADDRESS_PROOF_REASON taxonomy + VerifyAddressProofResult type
  verifier.ts    canonicalizeJson, sha256Hex, encodeSep53Message, ADDRESS_PROOF_DOMAIN,
                 ADDRESS_PROOF_BODY_FIELD, verifyAddressProof  ← endpoint-agnostic
  context.ts     Fastify module augmentation + request.onrampPrincipal (via decorateRequest)
  middleware.ts  onrampAuthPreHandler({ mode }) — verify → mode policy → metric → stash principal
  *.test.ts      table-driven unit tests + a test-only proof minter (makeAddressProof)

src/route/index.ts         /onramp/token: preHandler = onrampAuthPreHandler; destination = principal
src/config.ts              + onrampAuthMode (parseMode-validated at load)
src/helper/metrics.ts      + freighter_backend_onramp_auth_requests_total{result,reason} + recordOnrampAuth
```

**Boundaries (primitive vs. consumer):**

- **Reusable primitive** (`verifier.ts`, `errors.ts`, `mode.ts`): _is this proof cryptographically
  valid for the claimed address, on this method+path+body?_ Nothing here is onramp-specific.
- **Onramp consumer** (`middleware.ts`, `context.ts`, `ONRAMP_AUTH_MODE`, the metric): _the onramp
  endpoint's rollout policy_ — mode gate, per-outcome action, adoption metric, principal stashing. A
  future consumer brings its own preHandler/mode/metric and reuses the verifier untouched.

## The proof — wire contract (porting-critical; reproduce byte-for-byte)

**Transport:** a JSON string field `address_proof` in the **POST body** (not an `Authorization`
header — the header is reserved for v2's JWT, which an authenticated onramp request carries
simultaneously):

```jsonc
// POST /api/v1/onramp/token body
{ "address_proof": "<base64url(canonicalClaims)>.<base64url(signature)>" }
```

- `base64url` is **unpadded** (RFC 4648 §5, no `=`). The two segments are dot-separated.
- No scheme literal (that was a header-era artifact; the field name carries the meaning now).

**Claims** (the object that is canonicalized then signed):

```jsonc
{ "sub": "G…", "method": "POST", "path": "/api/v1/onramp/token", "body_hash": "<hex>", "exp": <int> }
```

- `sub` — the signer's Stellar strkey public key; **is** the Coinbase destination.
- `body_hash` — `sha256_hex(canonicalizeJson(businessBody))`, where **`businessBody` is the request
  body with the `address_proof` field removed** (the sign-everything-but-the-signature pattern —
  the proof can't hash itself). For current onramp clients `businessBody` is `{}`.
- `exp` — unix **seconds**, an **integer**, set to `now + 15`.

**Signed bytes (the critical part):**

```
signedMessage = ADDRESS_PROOF_DOMAIN + canonicalizeJson(claims)
digest        = SHA256( "Stellar Signed Message:\n"  ++  signedMessage )      // SEP-53 framing
signature     = Ed25519_sign(digest, signerSecretKey)
```

- `ADDRESS_PROOF_DOMAIN = "freighter:address-proof:v1\n"` (a constant, **not transmitted**; bytes
  include the trailing `\n` = 0x0A). It is a versioned domain separator — see §Cross-protocol
  hardening. **Named generically on purpose:** the tag lives in the signed bytes, so renaming it later
  is a wire-breaking `v2` requiring a lockstep client rollout. A single `address-proof` tag is shared
  across all consumers; endpoints are separated by the `path` claim, not by the tag.
- The SEP-53 prefix `"Stellar Signed Message:\n"` is the same one the clients' generic message signer
  uses; the domain tag is what distinguishes an address proof from an arbitrary signed message.

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

**Verification order** (`verifyAddressProof`), each failure mapped to `{status, reason}`:

1. No `address_proof` body field → `401 no_token` (anonymous-eligible in permissive).
2. Not two dot-segments / base64url or JSON parse failure / wrong claim field types → `401 malformed`.
3. `sub` not a valid Ed25519 strkey → **`400 bad_claims`**, _before any Coinbase call_.
4. Expiry window: reject if `now > exp + 5` (expired) or `exp > now + 15 + 5` (too far future) →
   `401 expired`. (≤15s lifetime, 5s skew — matches #112's `ClockSkewLeeway`.)
5. `method` / `path` mismatch vs the actual request → `401 bad_claims`.
6. `body_hash != sha256_hex(canonicalizeJson(businessBody))` (body minus `address_proof`) →
   `401 bad_claims`.
7. `Ed25519_verify(digest, signature, sub)` fails → `401 bad_signature`.
   - The digest is recomputed over `ADDRESS_PROOF_DOMAIN + receivedCanonicalPayloadBytes` — i.e. the
     bytes as received, not a re-canonicalization.
8. Success → principal = `sub`.

## Divergences from #112 (intended)

1. **`sub`** is a Stellar `G…` strkey (proves address ownership, and _is_ the destination), not a hex
   Ed25519 user ID. Validate via strkey decode, not raw hex.
2. **Envelope** is a SEP-53 signed message in the request **body**, not a Bearer JWT in the
   `Authorization` header. Two reasons:
   - _Forced by the signer:_ the onramp clients include **Ledger hardware wallets**, whose on-device
     Stellar app produces SEP-53 message signatures (native `SIGN_MESSAGE` APDU, app ≥ v6.0.0;
     `@ledgerhq/hw-app-str` ≥ 7.3.0), not raw JWT-signing-input signatures — a pure EdDSA JWT can't be
     produced on a Ledger.
   - _Forced by the layering:_ the address proof is orthogonal to authentication and must coexist with
     v2's JWT on the same request; a single `Authorization` header can't carry both a `Bearer` JWT and
     a `Stellar` proof, so the proof goes in the body.
3. Claims carry `method` + `path` separately (vs #112's combined `methodAndPath`); no `iat` (the
   server bounds lifetime via the `exp ≤ now+15+skew` check rather than `exp-iat`).
4. Coarser reason set (no body/timing-specific reasons).

## Cross-protocol hardening

The address proof and the clients' public `signMessage` dApp API use the same SEP-53 signing
primitive. To keep the two signing domains separate, `ADDRESS_PROOF_DOMAIN` is folded into the signed
bytes and required by the verifier, so an address proof is distinct from a generic signed message. The
clients' public `signMessage` path additionally refuses to sign messages beginning with the tag, so
address proofs originate only from the internal signer (lands with the client PRs).

## Reusing the address proof (adding a second consumer)

The verifier is endpoint-agnostic: it takes `{ method, path, body, nowSeconds }`, reads the proof from
the `address_proof` body field, and binds the proof to the request via the `method`/`path`/`body_hash`
claims. A new endpoint that needs address ownership:

1. Signs a proof with its own `path` (e.g. `"/api/v1/some-endpoint"`). The `path` claim scopes the
   proof — an onramp proof cannot be replayed here (`bad_claims`).
2. Reuses the **same** `ADDRESS_PROOF_DOMAIN` tag (endpoints are separated by `path`, not by tag).
3. Calls `verifyAddressProof` from its handler (or a thin preHandler mirroring `onrampAuthPreHandler`),
   then reads the proven `sub`.
4. Brings its **own** rollout mode flag and adoption metric (policy is per-consumer; the verifier is
   shared).

**When to add an address proof vs. JWT-only:** attach an address proof only to endpoints that take a
**privileged action on behalf of a specific address** (onramp funds it). Read/advisory endpoints
(e.g. Blockaid scans) need only authentication (JWT) — and address ownership would not even mitigate
quota abuse there (same sybil bypass as per-principal rate limiting; the control is aggregate/global).

## Porting to freighter-backend-v2 (Go)

When v2 grows an onramp (or other address-bound) endpoint, this gate ports to Go as a **second,
independent auth layer** alongside #112's JWT — not a replacement for it. v2 authenticates with JWT in
`Authorization` (identity) **and** validates the in-body address proof (ownership) on the same request;
there is **no** second `Authorization` scheme.

Reuse v2's `Mode`, `context`, metric, and reason vocabulary; add a _new_ SEP-53 address-proof verifier
alongside the JWT one.

File mapping:

| v1 (TS)                  | v2 (Go)                                                                        |
| ------------------------ | ------------------------------------------------------------------------------ |
| `src/auth/mode.ts`       | reuse existing `internal/auth/mode.go` (values already match)                  |
| `src/auth/errors.ts`     | reuse/extend `internal/auth/errors.go` reasons                                 |
| `src/auth/context.ts`    | reuse `internal/auth/context.go` (stash the proven address)                    |
| `src/auth/verifier.ts`   | **new** `internal/auth/address_proof_verifier.go` (distinct from JWT verifier) |
| `src/auth/middleware.ts` | new address-proof branch in the consuming handler (not the JWT middleware)     |
| `src/helper/metrics.ts`  | reuse the `{result,reason}` auth counter                                       |

**Cross-language landmines (where Go silently diverges) — the canonicalization must be byte-identical:**

- **HTML escaping:** JS `JSON.stringify` leaves `<` `>` `&` raw; Go's `encoding/json` escapes them
  **by default**. Go MUST `json.Encoder.SetEscapeHTML(false)` (or build the canonical string manually).
- **`exp` is an integer** (unix seconds), never a float — integer marshaling matches; floats wouldn't.
- **ASCII-only invariant:** every canonicalized field today (`sub` strkey `[A-Z2-7]`, `"POST"`, the
  path, hex `body_hash`, integer `exp`) is ASCII, so key-sort order and string escaping are
  unambiguous across languages. Preserve this invariant if fields are ever added.
- **body_hash carve-out:** both languages must hash the body with the `address_proof` field removed,
  using the same canonicalization, before comparing.
- **Exact bytes:** `ADDRESS_PROOF_DOMAIN = "freighter:address-proof:v1\n"` and SEP-53 prefix
  `"Stellar Signed Message:\n"` both include a trailing `\n` (0x0A). `base64url` is **unpadded**.
- **Crypto:** SHA-256; Ed25519 verify (`crypto/ed25519`); decode `sub` with `stellar/go`'s `strkey`
  (`strkey.Decode(strkey.VersionByteAccountID, sub)` → 32-byte pubkey).
- Verify over the **received** canonical bytes, not a re-canonicalization (defensive parity with v1).

The `ADDRESS_PROOF_DOMAIN` carries a `v1` version; any future protocol change bumps it in lockstep
across the TS verifier, the Go verifier, and all client signers.

## Observability

- Metric `freighter_backend_onramp_auth_requests_total{result, reason}` (sibling of v2's
  `freighter_auth_requests_total`). Onramp-consumer-scoped; a future consumer adds its own series.
  - `result ∈ {authenticated, anonymous, rejected}` — rollout-adoption signal.
  - `reason ∈ {ok, no_token, expired, bad_signature, bad_claims, malformed}` — fixed categories
    (never a request value), so rejection spikes triage by cause without label-cardinality risk.
- Each mint logs the principal + destination (a public address) and `authMode`; never secret material
  or signature bytes.

## Testing

- **verifier unit tests** (table-driven) with a test-only minter (`makeAddressProof`): valid; missing
  (no `address_proof` field); malformed (dots/base64/json/types); invalid strkey → 400; expired-past /
  too-far-future / ±5s skew boundary; method/path mismatch; body tamper; wrong-key → bad_signature;
  **untagged signature (generic SEP-53) → bad_signature** (the cross-protocol regression).
- **route tests:** signed mint uses the proven `sub` (ignores body `address`); permissive unsigned →
  200 (legacy path); present-but-invalid → 401; strict unsigned → 401 (the ticket repro); strict valid
  StrKey-but-bad → 400.

## Operational notes

- New env/config var: `ONRAMP_AUTH_MODE` (default `permissive`).
- New metric: `freighter_backend_onramp_auth_requests_total`.
- New address-proof error strings on `/onramp/token` (401/400).
- Reflected in `wallet-eng-runbooks` (onramp-token runbook), handled via the runbook reconcile step.
