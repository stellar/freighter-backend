# Freighter-Backend

Freighter's indexer integration layer and general backend.

## Documentation

| Document                                       | What it covers                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| [docs/README.md](./docs/README.md)             | Entry point for backend operational and architecture docs         |
| [docs/architecture.md](./docs/architecture.md) | Runtime topology, dependencies, request flow, and build artifacts |
| [docs/runbook.md](./docs/runbook.md)           | Startup, configuration, health checks, and incident response      |
| [docs/workers.md](./docs/workers.md)           | Price worker and Mercury integrity-check worker behavior          |
| [docs/metrics.md](./docs/metrics.md)           | Prometheus endpoint, metrics, labels, and scrape notes            |
| [docs/debugging.md](./docs/debugging.md)       | Logs, source maps, Redis inspection, and common pitfalls          |
| [docs/mercury.md](./docs/mercury.md)           | Mercury-specific integration notes                                |

## Prerequisites

You will need

- Node (>=25.3.0): https://nodejs.org/en/download/
- Yarn (>=v1.22.5): https://classic.yarnpkg.com/en/docs/install

## Development

This application relies on a Redis instance when `MODE=production`, you can either run `docker compose up` to use docker to stand up a Redis or you can start one on the standard port manually. If you're running in development mode, it uses a memory store.

To start the server in development mode, run:
`yarn i && yarn start`

For full operational details, start with [the docs index](./docs/README.md) or jump directly to [the runbook](./docs/runbook.md).

## Production build

`yarn build:prod`

## Mercury Details

This project integrates with Mercury, an indexer for Stellar/Soroban. You can find general developer documentation in [their repo docs](https://github.com/xycloo/merury-developers-documentation/blob/main/src/SUMMARY.md).

For full integration details, see [the Mercury docs](./docs/mercury.md).

## Coinbase integrations

This project connects to Coinbase to generate a session token. In order to retrieve this locally, enter Coinbase API key and Coinbase API secret in `.env`. These values can be generated in the Coinbase Developer Platform in `API Keys`.

### `FREIGHTER_TRUST_PROXY_RANGE` configuration

`FREIGHTER_TRUST_PROXY_RANGE` controls which upstream-proxy IPs Fastify trusts when computing `request.ip`. `/onramp/token` forwards the resolved IP to Coinbase to bind the issued session — get this wrong and either real users get sessions Coinbase rejects at redemption, or (in the worst case) sessions get bound to an IP that's effectively shared across many clients. Fail-closed at the handler catches the most dangerous case (`request.ip` resolves to a private/internal address — endpoint returns 400 instead of minting an unbound session), but it doesn't catch _wrong-but-public_ bindings, so getting the trust range right matters.

The variable is optional. If unset or empty, the application falls back to the built-in default of `loopback,linklocal,uniquelocal`, which covers the typical k8s / load-balancer topology. Any non-empty invalid value crashes startup via `proxy-addr`.

**Pick your config based on your topology:**

| Topology                                                         | Recommended value                                                                                                                                | Why                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kubernetes + cloud LB (AWS NLB/ALB, GCP, Azure), pods on RFC1918 | leave default (`loopback,linklocal,uniquelocal`)                                                                                                 | Default trusts the pod-to-ingress hop in any RFC1918 range; works without configuration.                                                                                                                                                                                                                                                                                                                       |
| Kubernetes with a known VPC CIDR you want to lock down           | explicit CIDR, e.g. `172.16.0.0/12`                                                                                                              | Stricter than the default — only the specific proxy CIDR is trusted. Useful when you know your VPC CIDR exactly and want to reject proxy hops from any other private range.                                                                                                                                                                                                                                    |
| Behind a CDN (Cloudflare, Akamai, Fastly, etc.)                  | explicit list including the CDN's egress ranges, e.g. `loopback,linklocal,uniquelocal,<cdn_cidr_1>,<cdn_cidr_2>`                                 | **The default does not trust CDN IPs.** Without the CDN's ranges in trust, `request.ip` resolves to the CDN's egress IP, sessions bind to the CDN, and either Coinbase rejects at redemption (best case) or many users share the same binding (worst case). [Cloudflare's IP ranges](https://www.cloudflare.com/ips/) are published; pin a snapshot in your config and refresh on Cloudflare's update cadence. |
| Service mesh (Istio, Linkerd) injecting a sidecar                | extend default with the sidecar's loopback range, e.g. include `loopback` (already in default) but check the sidecar uses `127.0.0.6` or similar | Default includes `loopback`, so most sidecars work without change. Verify by checking `socketRemote` in the warning log if `/onramp/token` returns 400 unexpectedly.                                                                                                                                                                                                                                           |
| Bare metal, no proxy                                             | leave default                                                                                                                                    | If clients connect directly, `socket.remoteAddress` is the public IP and Fastify uses it without walking XFF. The default is safe because there's no trusted hop to walk past.                                                                                                                                                                                                                                 |
| Anything else (multi-hop, custom NAT, etc.)                      | explicit list of every trusted proxy CIDR in the chain                                                                                           | Default is unlikely to fit; configure deliberately.                                                                                                                                                                                                                                                                                                                                                            |

**Recommended observability for any deployment:**

- Alert on the warning log line `"Refusing to issue an unbound Coinbase session"`. Any non-zero rate indicates a trust-chain misconfiguration — real users behind a correctly-configured proxy should never produce this log. Inspect the structured fields (`rawIp`, `xff`, `xRealIp`, `socketRemote`) to see what Fastify is observing and update `FREIGHTER_TRUST_PROXY_RANGE` accordingly.
- Alert on the `/api/v1/onramp/token` 4xx rate. A spike that correlates with the warning above is the same trust-chain misconfiguration; a spike without the warning is a Coinbase upstream issue or a client-side regression.
- For CDN-fronted deployments specifically, also monitor Coinbase session-redemption-failure rate if your Coinbase merchant dashboard exposes one — that's the signal for _wrong-but-public_ IP bindings (the failure mode the application itself can't detect, since the IP is public so `isLikelyInternalIp` returns false).

### Testing `/onramp/token` locally

`/onramp/token` forwards the caller's public IP to Coinbase to bind the resulting session, and refuses to issue a session if the resolved IP is private/internal (loopback, RFC1918, link-local, IPv6 ULA). On localhost the source address is `127.0.0.1`, so requests fail closed with `400 Could not determine client IP for Coinbase session binding` by default.

**For ad-hoc curl/Postman testing**, send an `X-Forwarded-For` header with a public IP. Fastify walks past loopback (which is trusted by the default `FREIGHTER_TRUST_PROXY_RANGE`) and treats your supplied IP as the client:

```bash
curl -X POST 'http://localhost:3002/api/v1/onramp/token' \
  -H 'Content-Type: application/json' \
  -H 'X-Forwarded-For: 203.0.113.42' \
  -d '{"address":"<stellar-G-address>"}'
```

`203.0.113.0/24` is the IETF documentation range — guaranteed unroutable, so it's obvious in logs that the request is from local dev.

**For testing via the Freighter extension hitting a local backend**, the extension's `fetch()` won't add `X-Forwarded-For` and the browser doesn't allow injecting it from JS. Run a small reverse proxy in front of `freighter-backend` that adds the header, then point the extension at the proxy port instead of the backend port directly.

Caddy (`brew install caddy`) does this in three lines. Save as `Caddyfile.dev`:

```
:3001 {
  reverse_proxy localhost:3002 {
    header_up X-Forwarded-For 203.0.113.42
  }
}
```

Run with `caddy run --config Caddyfile.dev`. Then in your local Freighter extension build, set the backend URL to `http://localhost:3001` (instead of `:3002`). Every request now arrives at `freighter-backend` with a synthetic XFF; the trust chain walks through loopback and treats `203.0.113.42` as the client.

The same approach works with nginx, Caddy, or any reverse proxy that can rewrite request headers. ngrok and Cloudflare Tunnel also work without any extra config — both inject the real client public IP into `X-Forwarded-For` automatically when forwarding to your local server.

> Don't add a dev-mode escape hatch in the application code that bypasses the IP check when `MODE=development`. The check is a safety invariant; the right shape of the workaround is "make local traffic look like real traffic" (proxy + XFF), not "make the application skip the check in dev."
