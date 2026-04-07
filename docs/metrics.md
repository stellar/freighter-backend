# Metrics

## Endpoint

Prometheus metrics are exposed by a dedicated Fastify server on port `9090`:

- URL: `GET /metrics`
- Example: `curl http://localhost:9090/metrics`
- Rate limit: `350` requests per minute

This endpoint is not served from the application port and does not live under `/api/v1`.

## What gets emitted

The backend emits both default process metrics and a small set of application metrics.

| Metric                                   | Type                       | Meaning                                                                        |
| ---------------------------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| `process_*`, `nodejs_*`                  | Default Prometheus metrics | Standard process and Node.js telemetry collected via `collectDefaultMetrics()` |
| `http_request_duration_s`                | Histogram                  | End-to-end request latency for API routes                                      |
| `freighter_backend_mercury_error_count`  | Counter                    | Mercury-side request errors                                                    |
| `freighter_backend_rpc_error_count`      | Counter                    | Horizon or Soroban RPC errors                                                  |
| `freighter_backend_critical_error_count` | Counter                    | Errors that need manual operator investigation                                 |
| `freighter_backend_integrity_check_pass` | Counter                    | Successful Mercury-vs-Horizon integrity checks                                 |
| `freighter_backend_integrity_check_fail` | Counter                    | Failed Mercury-vs-Horizon integrity checks                                     |
| `freighter_backend_scan_miss_count`      | Counter                    | Blockaid scan failures that fell back to a miss/default response               |

## Request latency labels

`http_request_duration_s` is labeled with:

| Label     | Source                                    |
| --------- | ----------------------------------------- |
| `method`  | HTTP method                               |
| `route`   | Normalized route name                     |
| `status`  | Final response status code                |
| `network` | `network` query-string value or `unknown` |

Route labels are normalized on purpose:

- Parameterized routes such as `/account-history/:pubKey` are grouped as `/account-history`.
- Only a whitelist of public routes gets its own label.
- Anything else is labeled as `other` to prevent metric-cardinality blowups.

One consequence of the current implementation is that routes that receive `network` in the request body, rather than in the query string, will show `network="unknown"` in request-duration metrics.

## Scrape example

```yaml
scrape_configs:
  - job_name: freighter-backend
    static_configs:
      - targets:
          - backend-hostname:9090
```

## Operational notes

- The API server and the metrics server use different rate limits: `100/minute` on the API, `350/minute` on `/metrics`.
- The two integrity-check counters are driven by worker messages from the Mercury integrity checker.
- `freighter_backend_critical_error_count` is the clearest signal that a background process stopped recovering on its own, especially for the price worker restart loop.
- If `/metrics` is empty or unavailable, debug the metrics server separately from the API server.

## Good alert candidates

These are the most useful signals to wire into alerting:

1. Sustained `5xx` responses or a rising `http_request_duration_s` p95.
2. Any increase in `freighter_backend_integrity_check_fail`.
3. Any increase in `freighter_backend_critical_error_count`.
4. A sharp increase in `freighter_backend_scan_miss_count`.
