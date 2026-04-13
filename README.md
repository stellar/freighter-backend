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
