
export const mutation = {
  authenticate: `
    mutation Auth {
      authenticate(input: {email: $email, password: $password}) {
        jwtToken
      }
    }
  `,
  newAccountSubscription: `
    mutation MyMutation {
      createFullAccountSubscription(
        input: {fullAccountSubscription: {$pubKey: PUBKEY!, userId: 1}}
      ) {
        clientMutationId
      }
    }
  `,

}
export const query = {
  subscriptionById: `
    query GetSubById {
      contractEventById($id: ID!) {
        id
        data
        contractId
        ledgerTimestamp
        nodeId
        topic1
        topic2
        topic3
        topic4
      }
    }
  `,
  allSubscriptions: `
    query AllSubscriptions {
      allContractEventSubscriptions {
        edges {
          node {
            contractId
          }
        }
      }
    }
  `,
  getAccountHistory: `
    query GetAccountHistory {
      // need this to take array of contracts
      query GetSubById {
        eventByContractId($searchedContractId: CONTRACT_ID!) {
          edges {
            node {
              data
              ledger
              ledgerTimestamp
              topic1
              topic2
              topic3
              topic4
            }
          }
        }
      }
      createAccountByPublicKey($publicKeyText: PUBKEY!) {
        edges {
          node
        }
      }
      createAccountToPublicKey($publicKeyText: PUBKEY!) {
        edges {
          node
        }
      }
      paymentsByPublicKey($publicKeyText: PUBKEY!) {
        edges {
          node {
            amount
            assetNative
            accountBySource {
              publickey
            }
            accountByDestination {
              publickey
            }
          }
        }
      }
      paymentsToPublicKey($publicKeyText: PUBKEY!) {
        edges {
          node {
            amount
            assetNative
            accountBySource {
              publickey
            }
            accountByDestination {
              publickey
            }
          }
        }
      }
    }
  `,
}