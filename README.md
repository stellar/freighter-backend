# Freighter-Backend

Freighter's indexer integration layer and general backend

## Prerequisites

You will need

- Node (>=18.0): https://nodejs.org/en/download/
- Yarn (>=v1.22.5): https://classic.yarnpkg.com/en/docs/install

## Development

This application relies on a Redis instance, you can either run `docker compose up` to use docker to stand up a Redis or you can start one on the standard port manually.

To start the server in development mode, run:
`yarn i && yarn start`

## Production build

`yarn build:prod`
