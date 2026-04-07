# Debugging

## Quick triage

| Symptom                              | First checks                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| API appears down                     | `curl http://localhost:3002/api/v1/ping`                                       |
| Metrics missing                      | `curl http://localhost:9090/metrics`                                           |
| Price data looks stale               | `curl http://localhost:3002/api/v1/price-worker-health` and inspect Redis keys |
| Mercury-backed routes look wrong     | Check `USE_MERCURY` in Redis, then review integrity-check logs and Sentry      |
| RPC problems reported by clients     | `curl "http://localhost:3002/api/v1/rpc-health?network=PUBLIC"`                |
| Horizon problems reported by clients | `curl "http://localhost:3002/api/v1/horizon-health?network=PUBLIC"`            |

## Logs

The service uses `pino` with `pino-pretty`.

Important logging behavior:

- request metadata is serialized with Pino standard serializers,
- request IP/port, host, user agent, and key account identifiers are redacted,
- `req.url` is also redacted and normalized for account-history and account-balances routes.

That means logs are safe to share more broadly than raw access logs, but they will not preserve full request identity for debugging.

## Production-style local debugging

Use a build when the issue might involve workers, bundle output, or source maps:

```bash
yarn build:prod
NODE_OPTIONS=--enable-source-maps node build/index.js --env production --port 3002
```

This gives you stack traces that map back to TypeScript source and exercises the same worker bundles that production uses.

## Useful Redis checks

```bash
redis-cli GET USE_MERCURY
redis-cli GET price_cache_initialized
redis-cli GET price_worker_last_update
redis-cli KEYS 'ts:price:*'
```

What they tell you:

- `USE_MERCURY=false`: the service has fallen back away from Mercury at runtime.
- missing `price_cache_initialized`: the price worker never finished bootstrap.
- stale `price_worker_last_update`: the worker is alive but not refreshing successfully.
- missing `ts:price:*` keys: price cache bootstrap likely failed or token prices are disabled.

## Known gotchas

1. The repo requires Node `>=25.3.0`. Older Node versions can block `yarn` commands before the app even starts.
2. `development` mode does not start Redis-backed workers, so worker-only issues must be reproduced from a production build.
3. `/api/v1/rpc-health` returns HTTP `200` even when the RPC reports an unhealthy status in the response body.
4. `/api/v1/price-worker-health` is not meaningful when Redis is unavailable or token prices are intentionally disabled.
5. The metrics endpoint lives on port `9090`, not on the main API port.

## When Mercury falls back

The integrity worker disables Mercury by writing `USE_MERCURY=false` to Redis on failures. Treat this as a protective circuit breaker:

1. confirm the failure in logs and Sentry,
2. compare Mercury and Horizon responses for the affected account or operation,
3. fix the upstream issue or wait for the provider to recover,
4. manually restore `USE_MERCURY=true`.

## When the price worker is unhealthy

Work through these checks in order:

1. confirm Redis is reachable,
2. confirm Horizon health at `${FREIGHTER_HORIZON_URL}/health`,
3. inspect `price_cache_initialized`,
4. inspect `price_worker_last_update`,
5. review logs for repeated restart attempts or cache-initialization failures.
