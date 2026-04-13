# Runbook

This document is the operator-focused guide for starting, checking, and recovering the backend.

## Prerequisites

- Node `>=25.3.0`
- Yarn `>=1.22.5`
- Docker (optional, but convenient for local Redis)

## Fast facts

| Item                        | Value                                              |
| --------------------------- | -------------------------------------------------- |
| Main API port               | `3002` by default                                  |
| Metrics port                | `9090`                                             |
| API prefix                  | `/api/v1`                                          |
| Development entrypoint      | `yarn start`                                       |
| Production build            | `yarn build:prod`                                  |
| Production runtime artifact | `node build/index.js --env production --port 3002` |

## Startup modes

### Development mode

Use this for route and integration work that does not depend on worker threads:

```bash
yarn install
yarn start
```

Behavior:

- the API server starts,
- the metrics server starts,
- Redis-backed workers do not start.

### Production-style local run

Use this when you need Redis, workers, or the built bundles:

```bash
docker compose up -d
yarn build:prod
node build/index.js --env production --port 3002
```

Notes:

- the CLI `--env` flag overrides runtime mode, but config validation still runs before route startup, so required environment variables must still be present in `.env` or the shell.
- the price worker and integrity-check worker are only exercised from the built output.

## Configuration

### Strict startup requirements

The current config validation is strict. These values are required at process start even if the related feature is turned off at runtime.

| Variable                                                                         | Purpose                         | Notes                                                                                                                                                           |
| -------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MODE`                                                                           | Base runtime mode               | `development` or `production`                                                                                                                                   |
| `HOSTNAME`                                                                       | Redis hostname                  | Used by Redis clients in production                                                                                                                             |
| `REDIS_CONNECTION_NAME`                                                          | Redis client connection name    | Shared by main process and workers                                                                                                                              |
| `REDIS_PORT`                                                                     | Redis port                      | Numeric                                                                                                                                                         |
| `USE_MERCURY`                                                                    | Initial Mercury runtime flag    | Persisted into Redis on startup                                                                                                                                 |
| `DISABLE_TOKEN_PRICES`                                                           | Price-worker feature flag       | Provide explicit `true` or `false`                                                                                                                              |
| `FREIGHTER_TRUST_PROXY_RANGE`                                                    | Fastify proxy trust range       | May be empty/unset, but if provided it must be a valid CIDR range — any non-empty invalid value is passed to `proxy-addr` and will crash the process at startup |
| `FREIGHTER_HORIZON_URL`                                                          | Horizon URL used by price logic | Also used by price-worker health checks                                                                                                                         |
| `FREIGHTER_RPC_PUBNET_URL`                                                       | Public Soroban RPC URL          | Required for RPC-backed routes                                                                                                                                  |
| `BLOCKAID_KEY`                                                                   | Blockaid API key                | Needed for scan routes                                                                                                                                          |
| `AUTH_EMAIL` / `AUTH_PASS`                                                       | Mercury pubnet credentials      | Required by current config validation                                                                                                                           |
| `AUTH_EMAIL_TESTNET` / `AUTH_PASS_TESTNET`                                       | Mercury testnet credentials     | Required by current config validation                                                                                                                           |
| `MERCURY_INTEGRITY_CHECK_ACCOUNT_EMAIL` / `MERCURY_INTEGRITY_CHECK_ACCOUNT_PASS` | Integrity-check Mercury account | Used by the worker when Mercury is enabled                                                                                                                      |

### Feature-specific configuration

| Variable                                   | Purpose                                                    | Default or note                                            |
| ------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------- |
| `SENTRY_KEY`                               | Sentry DSN for integrity-check failures                    | Required in practice when `USE_MERCURY=true` in production |
| `FREIGHTER_RPC_TESTNET_URL`                | Testnet RPC override                                       | Defaults to `https://soroban-testnet.stellar.org/`         |
| `FREIGHTER_RPC_FUTURENET_URL`              | Futurenet RPC override                                     | Defaults to `https://rpc-futurenet.stellar.org/`           |
| `COINBASE_API_KEY` / `COINBASE_API_SECRET` | Coinbase onramp integration                                | Needed for `/api/v1/onramp/token`                          |
| `PRICE_BATCH_UPDATE_DELAY_MS`              | Delay between price update batches                         | Default `5000`                                             |
| `PRICE_CALCULATION_TIMEOUT_MS`             | Per-token calculation timeout                              | Default `10000`                                            |
| `PRICE_TOKEN_UPDATE_BATCH_SIZE`            | Tokens per price update batch                              | Default `25`                                               |
| `PRICE_UPDATE_INTERVAL`                    | Delay between worker refresh loops                         | Default `60000`                                            |
| `PRICE_STALENESS_THRESHOLD`                | Max age for `price_worker_last_update` before health fails | Default `0`, which disables the staleness check            |
| `USD_RECEIVE_VALUE`                        | Price pathfinding target amount                            | Default `500`                                              |
| `PRICE_ONE_DAY_THRESHOLD_MS`               | Tolerance window for 24h price lookups                     | Default `300000`                                           |

## Health checks

| Check            | URL                                         | Healthy behavior                     | Important nuance                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Process liveness | `GET /api/v1/ping`                          | `200 Alive!`                         | Confirms the main process is answering HTTP                                                                                                                                                                                                                                                                                                                           |
| Price worker     | `GET /api/v1/price-worker-health`           | `200 {"status":"healthy"}`           | Returns `503` when Redis is missing, Horizon is unhealthy, cache bootstrap failed, or price data is stale. Also returns `503` when `DISABLE_TOKEN_PRICES=true` because the worker does not run and `price_cache_initialized`/`price_worker_last_update` are never set—this is expected and not an incident. Only monitor this endpoint when token prices are enabled. |
| Soroban RPC      | `GET /api/v1/rpc-health?network=PUBLIC`     | `200` with RPC health payload        | Can return `200` with `{"status":"unhealthy"}` in the body on failures                                                                                                                                                                                                                                                                                                |
| Horizon          | `GET /api/v1/horizon-health?network=PUBLIC` | `200` with Horizon `/health` payload | Returns `500` with null health fields on failures                                                                                                                                                                                                                                                                                                                     |
| Feature flags    | `GET /api/v1/feature-flags`                 | `200 {"useSorobanPublic":true}`      | Does not expose the runtime `USE_MERCURY` Redis flag                                                                                                                                                                                                                                                                                                                  |
| Metrics          | `GET /metrics` on port `9090`               | Prometheus text payload              | Separate server and separate rate limiter                                                                                                                                                                                                                                                                                                                             |

## Verification checklist after startup

```bash
curl http://localhost:3002/api/v1/ping
curl http://localhost:9090/metrics
curl "http://localhost:3002/api/v1/rpc-health?network=PUBLIC"
curl "http://localhost:3002/api/v1/horizon-health?network=PUBLIC"
redis-cli GET USE_MERCURY
redis-cli GET price_cache_initialized
redis-cli GET price_worker_last_update
```

Interpretation:

- `USE_MERCURY=true` means Mercury is currently enabled for runtime routing.
- missing `price_cache_initialized` means the price worker has not completed bootstrap.
- missing or stale `price_worker_last_update` means the price worker is not refreshing successfully.

## Incident playbooks

### Mercury integrity failure

Symptoms:

- `freighter_backend_integrity_check_fail` increases,
- Sentry receives an integrity-check exception,
- Redis key `USE_MERCURY` flips to `false`.

Response:

1. Confirm the fallback state with `redis-cli GET USE_MERCURY`.
2. Review the failing operation in logs and Sentry.
3. Compare Mercury and Horizon responses for the affected account or operation.
4. Leave `USE_MERCURY=false` until the data mismatch is understood and resolved.
5. Re-enable Mercury manually with `redis-cli SET USE_MERCURY true`.

### Price worker unhealthy

Symptoms:

- `/api/v1/price-worker-health` returns `503`,
- `price_worker_last_update` stops moving,
- `freighter_backend_critical_error_count` increases.

Response:

1. Confirm Redis connectivity.
2. Check `${FREIGHTER_HORIZON_URL}/health`.
3. Inspect `price_cache_initialized` and `price_worker_last_update`.
4. Review logs for repeated cache initialization errors or restart attempts.
5. If the price worker exhausted its retry budget, restart the service after fixing the underlying issue.

### Metrics unavailable

Symptoms:

- Prometheus scrape failures,
- `curl http://host:9090/metrics` does not return text exposition data.

Response:

1. Confirm the main process is still running.
2. Check whether port `9090` is bound and reachable.
3. Treat metrics-server failures separately from application-port failures.

## Testing

Run the unit test suite with:

```bash
yarn test
```

### Mercury integrity test

To exercise Mercury data integrity against Horizon, configure your env with `USE_MERCURY=true` and `MODE=production`. The integrity-check worker will continuously process new blocks, query both Mercury and Horizon for the same operation, normalize both responses into a common schema, and compare them for correctness.

On an integrity failure the `USE_MERCURY` Redis flag flips to `false` and the application falls back to serving requests from Horizon / RPC.

## Related docs

- [Architecture](./architecture.md)
- [Workers](./workers.md)
- [Metrics](./metrics.md)
- [Debugging](./debugging.md)
- [Mercury integration](./mercury.md)
