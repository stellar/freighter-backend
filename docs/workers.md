# Workers

The backend uses worker threads for long-running background tasks that should not block request handling.

## Worker inventory

| Worker            | Bundle                  | Starts when                                        | Main dependencies                            |
| ----------------- | ----------------------- | -------------------------------------------------- | -------------------------------------------- |
| Price worker      | `build/price-worker.js` | `MODE=production` and `DISABLE_TOKEN_PRICES=false` | Redis time series, Horizon                   |
| Integrity checker | `build/worker.js`       | `MODE=production` and `USE_MERCURY=true`           | Redis, Mercury, Horizon, Soroban RPC, Sentry |

## Price worker

### Responsibilities

The price worker:

1. Connects its own Redis client.
2. Initializes the token price cache if `price_cache_initialized` is missing.
3. Periodically refreshes cached prices.
4. Updates `price_worker_last_update` after successful refreshes.

### Redis state it owns

| Key or prefix              | Meaning                                                   |
| -------------------------- | --------------------------------------------------------- |
| `price_cache_initialized`  | Price cache bootstrap has completed                       |
| `price_worker_last_update` | Epoch timestamp of the last successful update             |
| `ts:price:*`               | Token price time-series keys                              |
| `token_counter`            | Priority input for deciding which tokens to refresh first |

### Restart behavior

The main process restarts the price worker automatically with exponential backoff:

- starts at `1s`
- doubles per failure
- caps at `5 minutes`
- stops after `10` retries

When the retry budget is exhausted, the service increments `freighter_backend_critical_error_count` and requires manual intervention.

## Mercury integrity-check worker

### Responsibilities

The integrity worker:

1. Opens a ledger stream against the public Horizon network.
2. Periodically samples operations from new ledgers.
3. Subscribes to Mercury data for the source account.
4. Compares Mercury and Horizon results after hydration.
5. Emits pass/fail worker messages back to the main process.

### Failure behavior

On a comparison failure or subscription failure, the worker:

- logs the failure,
- reports the exception to Sentry,
- increments the integrity-fail path in metrics, and
- writes `USE_MERCURY=false` into Redis.

That last step is intentionally sticky. The service does not automatically re-enable Mercury after a pass. Operators need to investigate the failure and then restore the flag manually.

### Manual recovery

After validating the upstream issue is resolved, re-enable Mercury explicitly:

```bash
redis-cli GET USE_MERCURY
redis-cli SET USE_MERCURY true
```

Do not reset the flag blindly. It is the production fallback mechanism that keeps public routes serving from Horizon/RPC when Mercury data diverges.

## Worker observability

| Signal                 | Where to check                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------- |
| Price worker status    | `GET /api/v1/price-worker-health`                                                     |
| Integrity outcomes     | `freighter_backend_integrity_check_pass` and `freighter_backend_integrity_check_fail` |
| Hard worker failure    | `freighter_backend_critical_error_count` and process logs                             |
| Mercury fallback state | Redis key `USE_MERCURY`                                                               |

## Local testing note

Workers are built artifacts. For production-style worker validation, use:

```bash
yarn build:prod
node build/index.js --env production --port 3002
```

`yarn start` is useful for API work, but it does not exercise worker startup the same way because the app is running through `ts-node`.
