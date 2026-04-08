# Freighter Backend V1 — LLM Quick Start

Evaluate the contributor's machine against all prerequisites for
freighter-backend (TypeScript/Fastify), install what's missing, and run the
initial setup.

## Step 1: Check all prerequisites

Run every check and collect results. Report all at once.

```bash
# Node.js >= 25.3.0
node --version 2>&1 || which node

# Yarn
yarn --version 2>&1 || which yarn

# Docker (needed for Redis in production mode)
docker --version 2>&1 || which docker

# Docker Compose
docker compose version 2>&1 || which docker-compose
```

## Step 2: Present results

```
Freighter Backend V1 — Prerequisites Check
============================================
  Node.js        v25.x.x        >= 25.3.0 required   OK
  Yarn           1.22.x         >= 1.22.5 required    OK
  Docker         27.x.x         any (for Redis)       OK
  Docker Compose 2.x.x          any                   OK
```

## Step 3: Install missing tools

Present missing tools and ask the user to confirm before installing.

**Auto-installable (run after user confirms):**

- **nvm + Node.js 25**: `nvm install 25`
- **Yarn**: `npm install --global yarn`
- **Docker**: `brew install --cask docker` (macOS) or follow
  [docs.docker.com](https://docs.docker.com/engine/install/) (Linux)

## Step 4: Configure environment

Check if `.env` exists. If not:

```bash
cp .env-EXAMPLE .env
```

For local development with `yarn start`, most values can stay as `not-set` — the
app uses an in-memory store. Set these for basic operation:

| Variable              | Value for local dev       |
| --------------------- | ------------------------- |
| `MODE`                | `development`             |
| `HOSTNAME`            | `localhost`               |
| `REDIS_PORT`          | `6379`                    |
| `REDIS_CONNECTION_NAME` | `freighter-dev`         |

## Step 5: Run initial setup

```bash
yarn install
yarn start              # Dev mode with in-memory store
```

For production mode (requires Redis):

```bash
docker compose up -d    # Start Redis
yarn build:prod
node build/index.js
```

## Step 6: Verify

```bash
yarn test               # Jest unit tests
```

## Step 7: Summary

```
Setup Complete
==============
  Prerequisites: [list with versions]
  Configured: .env from .env-EXAMPLE

  Ready to run:
  - yarn start           (dev mode, in-memory store)
  - docker compose up -d (start Redis for production mode)
```
