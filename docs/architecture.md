# Architecture

## Runtime topology

```text
Clients
  |
  v
Fastify API server (:3002 by default, /api/v1/*)
  |-- Mercury + Horizon + Soroban RPC clients
  |-- Blockaid service
  |-- Coinbase onramp token helper
  |-- Redis-backed feature/runtime state (production)
  |
  +-- Prometheus metrics server (:9090, /metrics)
  +-- Price worker (production unless DISABLE_TOKEN_PRICES=true)
  +-- Mercury integrity-check worker (production when USE_MERCURY=true)
```

## Main process responsibilities

The main process in `src/index.ts` is responsible for:

1. Loading `.env`, building config, and applying CLI overrides for `--env` and `--port`.
2. Creating the shared Prometheus registry and default process metrics.
3. Connecting Redis in production mode, including a dedicated Redis time-series client for token prices.
4. Initializing the public API server and a separate metrics server.
5. Spawning worker-thread bundles for token prices and Mercury integrity checks.
6. Handling shutdown signals and clearing metrics on exit.

## Major components

| Component         | Responsibility                           | Notes                                                                   |
| ----------------- | ---------------------------------------- | ----------------------------------------------------------------------- |
| API server        | Serves `/api/v1/*` routes                | Fastify with CORS, Helmet, AJV validation, and request-duration metrics |
| Metrics server    | Serves Prometheus metrics                | Separate Fastify instance on port `9090`                                |
| `MercuryClient`   | Mercury/Horizon/Soroban abstraction      | Used by public routes and the integrity-check worker                    |
| `BlockAidService` | Dapp, transaction, and asset scans       | Emits scan-miss metrics on provider failures                            |
| `PriceClient`     | Token price calculation and cache access | Uses Redis time series for historical price data                        |
| Integrity checker | Verifies Mercury data against Horizon    | Can flip the runtime `USE_MERCURY` flag off on failure                  |
| Price worker      | Maintains price cache freshness          | Initializes cache, updates prices, and records last-update timestamps   |

## Data flow and runtime state

### Request flow

1. Clients call versioned routes under `/api/v1`.
2. Each request is timed with the `http_request_duration_s` histogram.
3. Route handlers delegate to Mercury, Horizon, Soroban RPC, Blockaid, Coinbase, or the price cache.
4. In production, Mercury usage is gated by a Redis-backed runtime flag (`USE_MERCURY`), so the service can fall back without a process restart.

### Redis usage

The backend uses Redis for both runtime state and time-series storage in production:

| Key or prefix              | Purpose                                                         |
| -------------------------- | --------------------------------------------------------------- |
| `USE_MERCURY`              | Runtime feature gate for Mercury-backed responses               |
| `price_cache_initialized`  | Signals that the price cache has been bootstrapped successfully |
| `price_worker_last_update` | Timestamp of the last successful price refresh                  |
| `ts:price:*`               | Redis time-series entries for token prices                      |
| `token_counter`            | Sorted set used to prioritize frequently requested tokens       |

## External dependencies

| Dependency  | Used for                                                                  |
| ----------- | ------------------------------------------------------------------------- |
| Redis       | Runtime feature flags, worker coordination, and price time-series storage |
| Mercury     | Indexed account and subscription data                                     |
| Horizon     | Fallback account data, health checks, and integrity comparisons           |
| Soroban RPC | RPC health checks, simulation, and transaction preparation                |
| Blockaid    | Dapp, transaction, and asset scanning                                     |
| Coinbase    | Onramp session token generation                                           |
| Sentry      | Integrity-check failure reporting                                         |

## Environment modes

| Mode          | Behavior                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| `development` | API and metrics servers run, but Redis-backed workers do not start                                             |
| `production`  | Redis is required, the price worker can start, and the Mercury integrity worker starts when `USE_MERCURY=true` |

Two important nuances:

- `yarn start` uses `ts-node`, which is fine for route work but is not the right way to validate worker behavior.
- Production builds emit separate worker bundles, so worker issues need to be debugged from the built output rather than from `src/index.ts` alone.

## Build artifacts

`yarn build:prod` produces these Node bundles in `build/`:

| Artifact                | Source                         |
| ----------------------- | ------------------------------ |
| `build/index.js`        | Main process                   |
| `build/worker.js`       | Mercury integrity-check worker |
| `build/price-worker.js` | Token price worker             |

All three bundles are built with source maps enabled, which makes production-style debugging much easier with `NODE_OPTIONS=--enable-source-maps`.
