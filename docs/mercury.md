# Mercury Integration Guide

Freighter's backend relies on data that is ingested and indexed by Mercury in order to serve different wallet views.

Mercury is an indexer and API built on Stellar, [see docs for more info.](https://www.mercurydata.app/)
Mercury allows users to subscribe to data on the network and query indexed data using a GraphQL API.

## Playground

To learn more about the available queries or to construct queries, you can use [the playground.](https://api.mercurydata.app:2083/graphiql)

Playground steps -

1. Aquire an access token by signing up for an account on the dashboard.

Testnet - https://test.mercurydata.app/
Pubnet - https://main.mercurydata.app/

Select "Get Access token" under Active Subscriptions and grab your token.

2. Add your access token to the playground.

You can add your token to be used in the requests the playground makes.
Click on the headers tab on the left pane at the bottom and add it in the following format -

```
{
  Authorization: "Bearer <TOKEN>"
}
```

3. Query for data in subscriptions
   At this point you can query for any data that you have a subscription on, for example to get `changeTrust` operations for an account you could run this query -

```
query Test {
  changeTrustByPublicKey(publicKeyText:"<PUBLIC_KEY>") {
    edges {
      node {
        opId
      }
    }
  }
}
```

## Subscriptions

In order to query data, you must subscribe to it first. Mercury supports subscription APIs for contract events, ledger entries, ledger entry expirations, and accounts.

See [full docs](https://docs.mercurydata.app/mercury-classic/subscriptions/api-definition) for more info.

## Adding a new query

Mercury queries can be added by adding a new key to the `query` map in the [queries file](../src/service/mercury/queries.ts).
Queries are stored as template strings that represent the GraphQL query. Arguments can be passed by writing the query as a function and interpolating the arguments into the template string.

Queries can be imported into anything that accepts GraphQL documents.
