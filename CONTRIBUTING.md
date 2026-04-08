# Contributing to Freighter Backend (V1)

TypeScript backend service powering the Freighter wallet. Provides indexing,
subscriptions, feature flags, notifications, token balances, and pricing data.

For the Stellar organization's general contribution guidelines, see the
[Stellar Contribution Guide](https://github.com/stellar/.github/blob/master/CONTRIBUTING.md).

## Prerequisites

| Tool   | Version   | Install                                                      |
| ------ | --------- | ------------------------------------------------------------ |
| Node.js | >= 25.3.0 | [nodejs.org](https://nodejs.org) or `nvm install 25`         |
| Yarn   | >= 1.22.5 | `npm install --global yarn`                                  |
| Docker | Latest    | [docker.com](https://docs.docker.com/get-docker/) (for Redis) |

## Getting Started

### Quick Setup with an LLM

If you use an LLM-powered coding assistant, you can automate the setup. The repo
includes a quick start guide ([`LLM-QUICK-START.md`](LLM-QUICK-START.md)) that
checks your environment, installs missing tools, configures `.env`, and verifies
the build.

Point your LLM assistant at `LLM-QUICK-START.md` and ask it to follow the steps.

If you don't use an LLM assistant, follow the manual setup below.

### Manual Setup

```bash
git clone https://github.com/stellar/freighter-backend.git
cd freighter-backend
cp .env-EXAMPLE .env    # Then fill in values (see below)
yarn install
yarn start              # Dev mode (uses in-memory store, no Redis needed)
```

For production mode (requires Redis):

```bash
docker compose up -d    # Starts Redis Stack on port 6379
yarn build:prod
node build/index.js
```

### Environment Variables

Copy `.env-EXAMPLE` to `.env`. For local development with `yarn start`, most
variables can be left as `not-set` — the app uses an in-memory store by default.

**Required for full functionality:**

| Variable            | Purpose                                        | How to obtain                       |
| ------------------- | ---------------------------------------------- | ----------------------------------- |
| `MODE`              | `development` or `production`                  | Set to `development` for local dev  |
| `HOSTNAME`          | Redis hostname                                 | `localhost`                         |
| `REDIS_PORT`        | Redis port                                     | `6379` (Docker Compose default)     |
| `REDIS_CONNECTION_NAME` | Redis connection name                      | Any string (e.g., `freighter-dev`)  |
| `FREIGHTER_RPC_PUBNET_URL` | Stellar pubnet RPC endpoint             | Your pubnet RPC URL                 |
| `FREIGHTER_TRUST_PROXY_RANGE` | Trusted proxy IP range               | `127.0.0.1/32` for local dev       |

**Optional — features degrade gracefully:**

| Variable              | Purpose                    | Notes                                |
| --------------------- | -------------------------- | ------------------------------------ |
| `AUTH_EMAIL` / `AUTH_PASS` | Mercury indexer auth    | Only needed if `USE_MERCURY=true`    |
| `SENTRY_KEY`          | Error tracking             | Leave as `not-set` for local dev     |
| `BLOCKAID_KEY`        | Transaction scanning       | Leave as `not-set` for local dev     |
| `COINBASE_API_KEY` / `COINBASE_API_SECRET` | Pricing data | Leave as `not-set` for local dev     |
| `FREIGHTER_HORIZON_URL` | Stellar Horizon endpoint | Defaults to public Horizon if unset  |

## Key Commands

```bash
yarn start              # Dev mode (in-memory store)
yarn build:prod         # Production build (webpack)
yarn test               # Jest unit tests
yarn test:ci            # Jest CI mode
```

## Code Conventions

- **Formatting:** Prettier + ESLint (extends `@stellar/eslint-config`)
- **Pre-commit hooks:** `pretty-quick --staged` + `lint-staged` (ESLint fix)
- **Framework:** Fastify v5 with CORS, Helmet, rate-limiting
- **Logging:** Pino
- **Monitoring:** Prometheus metrics via `prom-client`

## Testing

```bash
yarn test               # Run all tests
yarn test:ci            # CI mode
```

Jest with `ts-jest` preset, Node test environment.

## Pull Requests

- Branch from `main`
- Commit messages: action verb in present tense
- All tests must pass
- Code must be formatted (pre-commit hooks handle this)

**CI runs on every PR:** build + test (`runTests.yaml`).

## Related Repositories

- [stellar/freighter-backend-v2](https://github.com/stellar/freighter-backend-v2)
  (Go) — V2 backend for collectibles, RPC health, protocols
- [stellar/freighter](https://github.com/stellar/freighter) — Browser extension
- [stellar/freighter-mobile](https://github.com/stellar/freighter-mobile) — Mobile app

## Security

- **Never log** API keys, auth credentials, or user data
- **Rate limiting** is enforced via Fastify plugin — don't bypass
- **Report vulnerabilities** via the
  [Stellar Security Policy](https://github.com/stellar/.github/blob/master/SECURITY.md)
  — not public issues
