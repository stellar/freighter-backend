export const mutation = {
  authenticate: `
    mutation Auth($email: String!, $password: String!) {
      authenticate(input: {email: $email, password: $password}) {
        jwtToken
      }
    }
  `,
  newAccountSubscription: `
    mutation NewAccountSubscription($pubKey: String!, $userId: String!) {
      createFullAccountSubscription(
        input: {fullAccountSubscription: pubKey: $pubKey, userId: $userId}}
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
  getAccountBalances: (ledgerKey: string, contractIds: string[]) => `
    query AccountBalances {
      ${contractIds.map(
        (id) =>
          `
        entryUpdateByContractIdAndKey(ledgerKey: "${ledgerKey}", contract: "${id}") {
          nodes {
            contractId
            keyXdr
            valueXdr
            ledgerTimestamp
            ledger
            entryDurability
          }
        }
        `
      )}
    }
  `,
  getAccountHistory: `
    query GetAccountHistory($pubKey: String!) {
      mintEvent: eventByTopic(t1: "AAAADgAAAARtaW50") {
        edges {
          node {
            contractId
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
      transferToEvent: eventByTopic(t1: "AAAADgAAAAh0cmFuc2Zlcg==", t2: $pubKey) {
        edges {
          node {
            contractId
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
      transferFromEvent: eventByTopic(t1: "AAAADgAAAAh0cmFuc2Zlcg==", t3: $pubKey) {
        edges {
          node {
            contractId
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
      createAccountByPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            destination
          }
        }
      }
      createAccountToPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            destination
          }
        }
      }
      paymentsByPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            amount
            assetNative
            assetByAsset {
              code
              issuer
            }
            accountBySource {
              publickey
            }
            accountByDestination {
              publickey
            }
          }
        }
      }
      paymentsToPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            amount
            assetNative
            assetByAsset {
              code
              issuer
            }
            accountBySource {
              publickey
            }
            accountByDestination {
              publickey
            }
          }
        }
      }

      allPathPaymentStrictReceiveOps(
        condition: {source: $pubKey}
      ) {
        edges {
          node {
            destAsset
            destAmount
            destAssetNative
            destination
            destinationMuxed
            source
            sourceMuxed
            sendMax
            sendAssetNative
            sendAsset
            path5AssetNative
            path5Asset
            path4AssetNative
            path4Asset
            path3AssetNative
            path3Asset
            path2AssetNative
            path2Asset
            path1AssetNative
            path1Asset
          }
        }
      }

      allPathPaymentStrictSendOps(
        condition: {source: $pubKey}
      ) {
        edges {
          node {
            destAsset
            destination
            destinationMuxed
            source
            sourceMuxed
            sendAssetNative
            sendAsset
            path1
          path1Native
          path2
          path2Native
          path3
          path3Native
          path4
          path4Native
          path5
          path5Native
          }
        }
      }

      allManageBuyOfferOps(condition: {source: $pubKey}) {
        edges {
          node {
            buyAmount
            buying
            buyingNative
            offerId
            priceD
            priceN
            selling
            sellingNative
            source
          }
        }
      }

      allManageSellOfferOps(condition: {source: $pubKey}) {
        edges {
          node {
            amount
            buying
            buyingNative
            selling
            priceN
            priceD
            sellingNative
            source
          }
        }
      }

      allCreatePassiveSellOfferOps(condition: {source: $pubKey}) {
        edges {
          node {
            amount
            buying
            buyingNative
            priceD
            priceN
            selling
            sellingNative
            source
          }
        }
      }

      allChangeTrustOps(condition: {source: $pubKey}) {
        totalCount
        edges {
          node {
            limit
            lineAsset
            lineNative
            linePoolShare
            source
          }
        }
      }

      allAllowTrustOps(condition: {source: $pubKey}) {
        totalCount
        edges {
          node {
            authorize
            code
            id
            source
            sourceMuxed
            trustor
          }
        }
      }

    }
  `,
};
