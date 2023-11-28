export const mutation = {
  authenticate: `
    mutation Auth($email: String!, $password: String!) {
      authenticate(input: {email: $email, password: $password}) {
        jwtToken
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
  getAccountBalances: (
    pubKey: string,
    ledgerKey: string,
    contractIds: string[]
  ) => `
    query AccountBalances {
      accountObjectByPublicKey(
        publicKeyText: "${pubKey}"
      ) {
        nodes {
          accountByAccount {
            publickey
          }
          nativeBalance
          numSubEntries
        }
      }
      balanceByPublicKey(
        publicKeyText: "${pubKey}"
      ) {
        nodes {
          assetByAsset {
            code
            issuer
          }
          accountByAccount {
            publickey
          }
          balance
        }
      }
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

      pathPaymentsStrictSendByPublicKey(publicKeyText: $pubKey) {
        nodes {
          ledgerByLedger {
            closeTime
            sequence
          }
          accountBySource {
            publickey
          }
          accountByDestination {
            publickey
          }
          assetByDestAsset {
            code
            issuer
          }
          assetByPath1 {
            code
            issuer
          }
          assetByPath2 {
            code
            issuer
          }
          assetByPath3 {
            issuer
            code
          }
          assetByPath4 {
            issuer
            code
          }
          assetByPath5 {
            issuer
            code
          }
          assetBySendAsset {
            code
            issuer
          }
          destAssetNative
          destMin
          path1Native
          path2Native
          path3Native
          path4Native
          path5Native
          sendAmount
          sendAssetNative
        }
      }

      pathPaymentsStrictSendToPublicKey(publicKeyText: $pubKey) {
        nodes {
          ledgerByLedger {
            closeTime
            sequence
          }
          accountBySource {
            publickey
          }
          accountByDestination {
            publickey
          }
          assetByDestAsset {
            code
            issuer
          }
          assetByPath1 {
            code
            issuer
          }
          assetByPath2 {
            code
            issuer
          }
          assetByPath3 {
            issuer
            code
          }
          assetByPath4 {
            issuer
            code
          }
          assetByPath5 {
            issuer
            code
          }
          assetBySendAsset {
            code
            issuer
          }
          destAssetNative
          destMin
          path1Native
          path2Native
          path3Native
          path4Native
          path5Native
          sendAmount
          sendAssetNative
        }
      }

      pathPaymentsStrictReceiveByPublicKey(publicKeyText: $pubKey) {
        nodes {
          ledgerByLedger {
            closeTime
            sequence
          }
          accountBySource {
            publickey
          }
          accountByDestination {
            publickey
          }
          assetByDestAsset {
            code
            issuer
          }
          assetByPath1Asset {
            code
            issuer
          }
          assetByPath2Asset {
            code
            issuer
          }
          assetByPath2Asset {
            issuer
            code
          }
          assetByPath4Asset {
            issuer
            code
          }
          assetByPath5Asset {
            issuer
            code
          }
          assetBySendAsset {
            code
            issuer
          }
          destAssetNative
          path1AssetNative
          path2AssetNative
          path3AssetNative
          path4AssetNative
          path5AssetNative
          sendAssetNative
          destAmount
          sendMax
        }
      }

      pathPaymentsStrictReceiveToPublicKey(publicKeyText: $pubKey) {
        nodes {
          ledgerByLedger {
            closeTime
            sequence
          }
          accountBySource {
            publickey
          }
          accountByDestination {
            publickey
          }
          assetByDestAsset {
            code
            issuer
          }
          assetByPath1Asset {
            code
            issuer
          }
          assetByPath2Asset {
            code
            issuer
          }
          assetByPath2Asset {
            issuer
            code
          }
          assetByPath4Asset {
            issuer
            code
          }
          assetByPath5Asset {
            issuer
            code
          }
          assetBySendAsset {
            code
            issuer
          }
          destAssetNative
          path1AssetNative
          path2AssetNative
          path3AssetNative
          path4AssetNative
          path5AssetNative
          sendAssetNative
          destAmount
          sendMax
        }
      }
    
      manageBuyOfferByPublicKey(
        publicKeyText: $pubKey
      ) {
        edges {
          node {
            buyingNative
            accountBySource {
              publickey
            }
            assetByBuying {
              issuer
              code
            }
            assetBySelling {
              code
              issuer
            }
            ledgerByLedger {
              closeTime
              sequence
            }
            muxedaccountBySourceMuxed {
              id
              publickey
            }
            offerId
            priceD
            priceN
            sellingNative
          }
        }
      }

      manageSellOfferByPublicKey(
        publicKeyText: $pubKey
      ) {
        edges {
          node {
            buyingNative
            accountBySource {
              publickey
            }
            assetByBuying {
              issuer
              code
            }
            assetBySelling {
              code
              issuer
            }
            ledgerByLedger {
              closeTime
              sequence
            }
            muxedaccountBySourceMuxed {
              id
              publickey
            }
            offerId
            priceD
            priceN
            sellingNative
          }
        }
      }

      createPassiveSellOfferByPublicKey(publicKeyText: $pubKey) {
        nodes {
          accountBySource {
            publickey
          }
          amount
          assetByBuying {
            code
            issuer
          }
          assetBySelling {
            code
            issuer
          }
          buyingNative
          ledgerByLedger {
            closeTime
            sequence
          }
          muxedaccountBySourceMuxed {
            id
            publickey
          }
          priceD
          priceN
          sellingNative
        }
      }

      changeTrustByPublicKey(publicKeyText: $pubKey) {
        nodes {
          accountBySource {
            publickey
          }
          assetByLineAsset {
            issuer
            code
          }
          ledgerByLedger {
            closeTime
            sequence
          }
          limit
          lineNative
          poolshareByLinePoolShare {
            assetA
            assetB
            fee
          }
        }
      }

    }
  `,
};
