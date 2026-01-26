## Prerequisites

- Node (>=25.3.0): https://nodejs.org/en/download/
- Yarn (>=v1.22.5): https://classic.yarnpkg.com/en/docs/install
- Docker: (optional) https://docs.docker.com/engine/install/

## Environment

| Variable Name                         | Description                                              |
| ------------------------------------- | -------------------------------------------------------- | ----------- |
| AUTH_EMAIL                            | Email address used to log in to Mercury(pubnet)          |
| AUTH_PASS                             | Password used to log in to Mercury(pubnet)               |
| AUTH_EMAIL_TESTNET                    | Email address used to log in to Mercury(testnet)         |
| AUTH_PASS_TESTNET                     | Password used to log in to Mercury(testnet)              |
| MERCURY_INTEGRITY_CHECK_ACCOUNT_EMAIL | Email address used to log in to Mercury(integrity check) |
| MERCURY_INTEGRITY_CHECK_ACCOUNT_PASS  | Password used to log in to Mercury(integrity check)      |
| REDIS_CONNECTION_NAME                 | Redis connection name                                    |
| REDIS_PORT                            | port for Redis                                           |
| HOSTNAME                              | hostname Redis is running at                             |
| MODE                                  | app run move(development                                 | production) |
| USE_MERCURY                           | flag to toggle use of Mercury                            |
| SENTRY_KEY                            | key to configure Sentry instance                         |
| BLOCKAID_KEY                          | key to configure Blockaid instance                       |

Relies on a Redis instance when `MODE=production`, you can either run `docker compose up` to use docker to stand up a Redis or you can start one on the configured port manually. If you're running in development mode, it uses a memory store instead.

## Setup

To install dependencies, run `yarn i`

## Development

Start development server -
`yarn start`

CLI arguments
-e | --env: (optional) Overrides the environment variable set for `MODE`, should be set to `development|production`
-p | --port: (optional) Sets the application port adn defaults to `3002`

## Production Build

`yarn build:prod`

## Testing

Run unit tests with `yarn test`.

## Mercury Integrity Test

In order to test Mercury for data integrity against Horizon, you can configure your env to `USE_MERCURY=true && MODE=production`.
This will result in a worker that continously processes new blocks, queries both Mercury and Horizon for the same transaction, transforms both responses into a common schema, and finally checks for correctness of the results.

In case of an integrity failure, the `USE_MERCURY` redis flag will be flipped to false and the application will fallback to serving requests from Horizon/Rpc.

## Metrics

Metrics are gathered using [Prometheus](https://prometheus.io/docs/introduction/overview/), and a standalone metrics server runs on the standard Prometheus port and exposes a `/metrics` route for collection.
