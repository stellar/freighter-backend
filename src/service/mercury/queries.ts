export const mutation = {
  authenticate: `
    mutation Auth {
      authenticate(input: {email: $email, password: $password}) {
        jwtToken
      }
    }
  `,
  newAccountSubscription: `
    mutation NewAccountSubscription {
      createFullAccountSubscription(
        input: {fullAccountSubscription: {$pubKey: PUBKEY!, $userId: USER_ID!}}
      ) {
        fullAccountSubscription {
          publickey
          id
        }
      }
    }
  `,
};
export const query = {
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
};
