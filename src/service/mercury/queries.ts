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
  getCurrentDataAccountBalances: (
    pubKey: string,
    ledgerKey: string,
    contractIds: string[]
  ) => `
    query AccountBalancesCurrentData {
      trustlinesByPublicKey(public: "${pubKey}") {
        balance
        asset
        limit
        accountId
      }

      accountByPublicKey(public: "${pubKey}") {
        accountId
        nativeBalance
        buyingLiabilities
        sellingLiabilities
        seqNum
        numSubentries
        numSponsored
        numSponsoring
      }

      ${contractIds.map(
        (id) => `
        ${id}: contractDataEntriesByContractAndKeys(contract: "${id}", keys: ["${ledgerKey}"]) {
          contractId,
          keyXdr,
          valXdr,
          durability
        }
        `
      )}
    }
  `,
  getAccountObject: (pubKey: string) => `
    query AccountObject {
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
            source
            tx
            opId
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              resultXdr
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
            source
            destination
            startingBalance
            opId
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              resultXdr
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
            source
            destination
            startingBalance
            opId
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              resultXdr
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
            source
            destination
            opId
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              resultXdr
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
            source
            destination
            opId
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              resultXdr
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
          source
          destination
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
            resultXdr
            ledgerByLedger {
              closeTime
              sequence
            }
          }
        }
      }

      pathPaymentsStrictSendToPublicKey(publicKeyText: $pubKey) {
        nodes {
          source
          destination
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
            resultXdr
            ledgerByLedger {
              closeTime
              sequence
            }
          }
        }
      }

      pathPaymentsStrictReceiveByPublicKey(publicKeyText: $pubKey) {
        nodes {
          source
          destination
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
            resultXdr
            ledgerByLedger {
              closeTime
              sequence
            }
          }
        }
      }

      pathPaymentsStrictReceiveToPublicKey(publicKeyText: $pubKey) {
        nodes {
          source
          destination
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
            resultXdr
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
            source
            assetByBuying {
              issuer
              code
            }
            assetBySelling {
              code
              issuer
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
              resultXdr
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
            source
            assetByBuying {
              issuer
              code
            }
            assetBySelling {
              code
              issuer
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
              resultXdr
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
          source
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
          priceD
          priceN
          sellingNative
          opId
          txInfoByTx {
            fee
            opCount
            txHash
            ledger
            resultXdr
            ledgerByLedger {
              closeTime
              sequence
            }
          }
        }
      }

      changeTrustByPublicKey(publicKeyText: $pubKey) {
        nodes {
          source
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
            resultXdr
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
            source
            destination
            source
            opId
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              resultXdr
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
            bumpTo
            opId
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              resultXdr
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
            balanceId
            opId
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              resultXdr
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
            source
            amount
            asset
            assetNative
            source
            opId
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              resultXdr
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
            source
            authorize
            code
            source
            trustor
            opId
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              resultXdr
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
            source
            dataName
            dataValue
            source
            opId
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              resultXdr
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
            opId
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              resultXdr
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
            opId
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              resultXdr
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
            sponsorship
            opId
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              resultXdr
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
            source
            amount
            asset
            assetNative
            from
            source
            opId
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              resultXdr
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
            source
            asset
            assetNative
            clearFlags
            setFlags
            source
            trustor
            opId
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              resultXdr
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
            source
            maxAmountA
            maxAmountB
            maxPriceD
            maxPriceN
            minPriceD
            source
            opId
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              resultXdr
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
            source
            amount
            minAmountA
            minAmountB
            source
            opId
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              resultXdr
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
            source
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
              resultXdr
              ledgerByLedger {
                closeTime
                sequence
              }
            }
          }
        }
      }

      setOptionsByPublicKey(publicKeyText: $pubKey) {
        edges {
          node {
            id
            opId
            clearFlags
            setFlags
            masterWeight
            lowThreshold
            medThreshold
            highThreshold
            homeDomain
            signerWeight
            signerKind
            signer
            signedPayload
            source
            txInfoByTx {
              fee
              opCount
              txHash
              ledger
              resultXdr
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
