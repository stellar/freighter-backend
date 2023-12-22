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
    query GetAccountHistory($pubKey: String!, $xdrPubKey: String!) {
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
      transferToEvent: eventByTopic(t1: "AAAADgAAAAh0cmFuc2Zlcg==", t2: $xdrPubKey) {
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
      transferFromEvent: eventByTopic(t1: "AAAADwAAAAh0cmFuc2Zlcg==", t3: $xdrPubKey) {
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
            accountByDestination {
              publickey
            }
            startingBalance
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              ledgerByLedger {
                closeTime
                sequence
              }
            }
          }
        }
      }
      createAccountToPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            accountByDestination {
              publickey
            }
            startingBalance
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              ledgerByLedger {
                closeTime
                sequence
              }
            }
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
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              ledgerByLedger {
                closeTime
                sequence
              }
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
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              ledgerByLedger {
                closeTime
                sequence
              }
            }
          }
        }
      }

      pathPaymentsStrictSendByPublicKey(publicKeyText: $pubKey) {
        nodes {
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
          txInfoByTx {
            fee
            opCount
            txHash
            ledger
            ledgerByLedger {
              closeTime
              sequence
            }
          }
        }
      }

      pathPaymentsStrictSendToPublicKey(publicKeyText: $pubKey) {
        nodes {
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
          txInfoByTx {
            fee
            opCount
            txHash
            ledger
            ledgerByLedger {
              closeTime
              sequence
            }
          }
        }
      }

      pathPaymentsStrictReceiveByPublicKey(publicKeyText: $pubKey) {
        nodes {
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
          txInfoByTx {
            fee
            opCount
            txHash
            ledger
            ledgerByLedger {
              closeTime
              sequence
            }
          }
        }
      }

      pathPaymentsStrictReceiveToPublicKey(publicKeyText: $pubKey) {
        nodes {
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
          txInfoByTx {
            fee
            opCount
            txHash
            ledger
            ledgerByLedger {
              closeTime
              sequence
            }
          }
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
            muxedaccountBySourceMuxed {
              id
              publickey
            }
            offerId
            priceD
            priceN
            sellingNative
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              ledgerByLedger {
                closeTime
                sequence
              }
            }
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
            muxedaccountBySourceMuxed {
              id
              publickey
            }
            offerId
            priceD
            priceN
            sellingNative
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              ledgerByLedger {
                closeTime
                sequence
              }
            }
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
          muxedaccountBySourceMuxed {
            id
            publickey
          }
          priceD
          priceN
          sellingNative
          txInfoByTx {
            fee
            opCount
            txHash
            ledger
            ledgerByLedger {
              closeTime
              sequence
            }
          }
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
          limit
          lineNative
          poolshareByLinePoolShare {
            assetByA {
              code
            }
            assetByB {
              code
            }
            fee
          }
          txInfoByTx {
            fee
            opCount
            txHash
            ledger
            ledgerByLedger {
              closeTime
              sequence
            }
          }
        }
      }

      accountMergeByPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            destination
            destinationMuxed
            source
            sourceMuxed
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              ledgerByLedger {
                closeTime
                sequence
              }
            }
          }
        }
      }

      bumpSequenceByPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            source
            sourceMuxed
            bumpTo
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              ledgerByLedger {
                closeTime
                sequence
              }
            }
          }
        }
      }

      claimClaimableBalanceByPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            source
            sourceMuxed
            balanceId
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              ledgerByLedger {
                closeTime
                sequence
              }
            }
          }
        }
      }

      createClaimableBalanceByPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            amount
            asset
            assetNative
            source
            sourceMuxed
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              ledgerByLedger {
                closeTime
                sequence
              }
            }
          }
        }
      }

      allowTrustByPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            authorize
            code
            source
            sourceMuxed
            trustor
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              ledgerByLedger {
                closeTime
                sequence
              }
            }
          }
        }
      }

      manageDataByPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            dataName
            dataValue
            source
            sourceMuxed
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              ledgerByLedger {
                closeTime
                sequence
              }
            }
          }
        }
      }

      beginSponsoringFutureReservesByPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            source
            sourceMuxed
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              ledgerByLedger {
                closeTime
                sequence
              }
            }
          }
        }
      }

      endSponsoringFutureReservesByPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            source
            sourceMuxed
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              ledgerByLedger {
                closeTime
                sequence
              }
            }
          }
        }
      }

      revokeSponsorshipByPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            source
            sourceMuxed
            sponsorship
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              ledgerByLedger {
                closeTime
                sequence
              }
            }
          }
        }
      }

      clawbackByPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            amount
            asset
            assetNative
            from
            fromMuxed
            source
            sourceMuxed
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              ledgerByLedger {
                closeTime
                sequence
              }
            }
          }
        }
      }

      setTrustLineFlagsByPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            asset
            assetNative
            clearFlags
            setFlags
            source
            sourceMuxed
            trustor
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              ledgerByLedger {
                closeTime
                sequence
              }
            }
          }
        }
      }

      liquidityPoolDepositByPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            maxAmountA
            maxAmountB
            maxPriceD
            maxPriceN
            minPriceD
            source
            sourceMuxed
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              ledgerByLedger {
                closeTime
                sequence
              }
            }
          }
        }
      }

      liquidityPoolWithdrawByPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            amount
            minAmountA
            minAmountB
            source
            sourceMuxed
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              ledgerByLedger {
                closeTime
                sequence
              }
            }
          }
        }
      }

    }
  `,
};
