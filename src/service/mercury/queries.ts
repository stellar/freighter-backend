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
  getAccountSubForPubKey: (pubKey: string) => `
    query AccountSub {
      allFullAccountSubscriptionsList(first:10, offset:0, condition: { publickey: "${pubKey}" }) {
        publickey
      }
    }
  `,
  getTokenBalanceSub: (contractId: string, keyXdr: string) => `
    query TokenBalanceSub {
      allEntryUpdates(first:10, offset:0, condition: { contractId: "${contractId}", keyXdr: "${keyXdr}" }) {
        nodes {
          contractId
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
          numSponsored
          numSponsoring
          sellingLiabilities
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
        ${id}: entryUpdateByContractIdAndKey(first: 1, ledgerKey: "${ledgerKey}", contract: "${id}") {
          nodes {
            contractId
            keyXdr
            valueXdr
            entryDurability
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
        `
      )}
    }
  `,
  getAccountHistory: `
    query GetAccountHistory($pubKey: String!) {
      invokeHostFnByPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            auth
            hostFunction
            sorobanMeta
            accountBySource {
              publickey
            }
            tx
            opId
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
      createAccountByPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            accountByDestination {
              publickey
            }
            startingBalance
            opId
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
            opId
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
            opId
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
            opId
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
          opId
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
          opId
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
          assetByPath1 {
            code
            issuer
          }
          assetByPath2 {
            code
            issuer
          }
          assetByPath2 {
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
          path1Native
          path2Native
          path3Native
          path4Native
          path5Native
          sendAssetNative
          destAmount
          sendMax
          opId
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
          assetByPath1 {
            code
            issuer
          }
          assetByPath2 {
            code
            issuer
          }
          assetByPath2 {
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
          path1Native
          path2Native
          path3Native
          path4Native
          path5Native
          sendAssetNative
          destAmount
          sendMax
          opId
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
            opId
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
            opId
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
          opId
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
          opId
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
            opId
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
            opId
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
            opId
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
            opId
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
            opId
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
            opId
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
            opId
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
            opId
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
            opId
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
            opId
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
            opId
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
            opId
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
            opId
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

      createClaimableBalanceToPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            amount
            asset
            assetNative
            source
            claimants
            opId
            destinationsPublic
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
