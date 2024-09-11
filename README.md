# Freighter-Backend

Freighter's indexer integration layer and general backend

## Prerequisites

You will need

- Node (>=20.0): https://nodejs.org/en/download/
- Yarn (>=v1.22.5): https://classic.yarnpkg.com/en/docs/install

## Development

This application relies on a Redis instance when `MODE=production`, you can either run `docker compose up` to use docker to stand up a Redis or you can start one on the standard port manually. If you're running in development mode, it uses a memory store.

To start the server in development mode, run:
`yarn i && yarn start`

For full runbook details, please reference [the runbook.](./docs/runbook.md)

## Production build

`yarn build:prod`

## Mercury Details

This project integrates with Mercury, an indexer for Stellar/Soroban. You can find general developer documentation (in their repo docs)[https://github.com/xycloo/merury-developers-documentation/blob/main/src/SUMMARY.md].
