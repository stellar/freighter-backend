import { OperationResult } from "@urql/core";
import { scValToNative, xdr } from "soroban-client";

// Transformers take an API response, and transform it/augment it for frontend consumption

interface MercuryAccountBalancesData {
  entryUpdateByContractIdAndKey: {
    nodes: {
      contractId: string;
      keyXdr: string;
      valueXdr: string;
    }[];
  };
}

interface TokenDetails {
  [k: string]: {
    name: string;
    symbol: string;
    decimals: string;
  };
}

const transformAccountBalances = async (
  rawResponse: OperationResult<MercuryAccountBalancesData>,
  tokenDetails: TokenDetails
) => {
  return rawResponse?.data?.entryUpdateByContractIdAndKey.nodes.map((entry) => {
    const details = tokenDetails[entry.contractId];
    return {
      ...entry,
      ...details,
    };
  });
};

interface MercuryAccountHistory {
  mintEvent: {
    edges: {
      node: {
        contractId: string;
        data: string;
        topic1: string; // to
        topic2: string; // amount
      };
    }[];
  };
  transferFromEvent: {
    edges: {
      node: {
        contractId: string;
        data: string;
        topic1: string; // to
        topic2: string; // from
        topic3: string; // amount
      };
    }[];
  };
  transferToEvent: {
    edges: {
      node: {
        contractId: string;
        data: string;
        topic1: string; // to
        topic2: string; // from
        topic3: string; // amount
      };
    }[];
  };
  createAccountByPublicKey: {
    edges: {
      node: {
        destination: string;
      };
    }[];
  };
  createAccountToPublicKey: {
    edges: {
      node: {
        destination: string;
      };
    }[];
  };
  paymentsByPublicKey: {
    edges: {
      node: {
        amount: string;
        assetNative: string;
        assetByAsset: {
          code: string;
          issuer: string;
        };
        accountBySource: {
          publickey: string;
        };
        accountByDestination: {
          publickey: string;
        };
      };
    }[];
  };
  paymentsToPublicKey: {
    edges: {
      node: {
        amount: string;
        assetNative: string;
        assetByAsset: {
          code: string;
          issuer: string;
        };
        accountBySource: {
          publickey: string;
        };
        accountByDestination: {
          publickey: string;
        };
      };
    }[];
  };
  pathPaymentsStrictSendByPublicKey: {
    nodes: {
      accountBySource: {
        publickey: string;
      };
      accountByDestination: {
        publickey: string;
      };
      assetByDestAsset: {
        code: string;
        issuer: string;
      };
      assetByPath1: {
        code: string;
        issuer: string;
      };
      assetByPath2: {
        code: string;
        issuer: string;
      };
      assetByPath3: {
        issuer: string;
        code: string;
      };
      assetByPath4: {
        issuer: string;
        code: string;
      };
      assetByPath5: {
        issuer: string;
        code: string;
      };
      assetBySendAsset: {
        code: string;
        issuer: string;
      };
      destAssetNative: string;
      destMin: string;
      path1Native: string;
      path2Native: string;
      path3Native: string;
      path4Native: string;
      path5Native: string;
      sendAmount: string;
      sendAssetNative: string;
    }[];
  };
  pathPaymentsStrictSendToPublicKey: {
    nodes: {
      accountBySource: {
        publickey: string;
      };
      accountByDestination: {
        publickey: string;
      };
      assetByDestAsset: {
        code: string;
        issuer: string;
      };
      assetByPath1: {
        code: string;
        issuer: string;
      };
      assetByPath2: {
        code: string;
        issuer: string;
      };
      assetByPath3: {
        issuer: string;
        code: string;
      };
      assetByPath4: {
        issuer: string;
        code: string;
      };
      assetByPath5: {
        issuer: string;
        code: string;
      };
      assetBySendAsset: {
        code: string;
        issuer: string;
      };
      destAssetNative: string;
      destMin: string;
      path1Native: string;
      path2Native: string;
      path3Native: string;
      path4Native: string;
      path5Native: string;
      sendAmount: string;
      sendAssetNative: string;
    }[];
  };
  pathPaymentsStrictReceiveByPublicKey: {
    nodes: {
      accountBySource: {
        publickey: string;
      };
      accountByDestination: {
        publickey: string;
      };
      assetByDestAsset: {
        code: string;
        issuer: string;
      };
      assetByPath1: {
        code: string;
        issuer: string;
      };
      assetByPath2: {
        code: string;
        issuer: string;
      };
      assetByPath3: {
        issuer: string;
        code: string;
      };
      assetByPath4: {
        issuer: string;
        code: string;
      };
      assetByPath5: {
        issuer: string;
        code: string;
      };
      assetBySendAsset: {
        code: string;
        issuer: string;
      };
      destAssetNative: string;
      destMin: string;
      path1Native: string;
      path2Native: string;
      path3Native: string;
      path4Native: string;
      path5Native: string;
      sendAmount: string;
      sendAssetNative: string;
    }[];
  };
  pathPaymentsStrictReceiveToPublicKey: {
    nodes: {
      accountBySource: {
        publickey: string;
      };
      accountByDestination: {
        publickey: string;
      };
      assetByDestAsset: {
        code: string;
        issuer: string;
      };
      assetByPath1: {
        code: string;
        issuer: string;
      };
      assetByPath2: {
        code: string;
        issuer: string;
      };
      assetByPath3: {
        issuer: string;
        code: string;
      };
      assetByPath4: {
        issuer: string;
        code: string;
      };
      assetByPath5: {
        issuer: string;
        code: string;
      };
      assetBySendAsset: {
        code: string;
        issuer: string;
      };
      destAssetNative: string;
      destMin: string;
      path1Native: string;
      path2Native: string;
      path3Native: string;
      path4Native: string;
      path5Native: string;
      sendAmount: string;
      sendAssetNative: string;
    }[];
  };
  manageBuyOfferByPublicKey: {
    edges: {
      node: {
        buyingNative: boolean;
        accountBySource: {
          publickey: string;
        };
        assetByBuying: {
          issuer: string;
          code: string;
        };
        assetBySelling: {
          code: string;
          issuer: string;
        };
        ledgerByLedger: {
          closeTime: string;
          sequence: string;
        };
        muxedaccountBySourceMuxed: {
          id: string;
          publickey: string;
        };
        offerId: string;
        priceD: string;
        priceN: string;
        sellingNative: boolean;
      };
    }[];
  };
  manageSellOfferByPublicKey: {
    edges: {
      node: {
        buyingNative: boolean;
        accountBySource: {
          publickey: string;
        };
        assetByBuying: {
          issuer: string;
          code: string;
        };
        assetBySelling: {
          code: string;
          issuer: string;
        };
        ledgerByLedger: {
          closeTime: string;
          sequence: string;
        };
        muxedaccountBySourceMuxed: {
          id: string;
          publickey: string;
        };
        offerId: string;
        priceD: string;
        priceN: string;
        sellingNative: boolean;
      };
    }[];
  };
  createPassiveSellOfferByPublicKey: {
    nodes: {
      accountBySource: {
        publickey: string;
      };
      amount: string;
      assetByBuying: {
        code: string;
        issuer: string;
      };
      assetBySelling: {
        code: string;
        issuer: string;
      };
      buyingNative: boolean;
      ledgerByLedger: {
        closeTime: string;
        sequence: string;
      };
      muxedaccountBySourceMuxed: {
        id: string;
        publickey: string;
      };
      priceD: string;
      priceN: string;
      sellingNative: boolean;
    }[];
  };
  changeTrustByPublicKey: {
    nodes: {
      accountBySource: {
        publickey: string;
      };
      assetByLineAsset: {
        issuer: string;
        code: string;
      };
      ledgerByLedger: {
        closeTime: string;
        sequence: string;
      };
      limit: string;
      lineNative: boolean;
      poolshareByLinePoolShare: {
        assetByA: {
          code: string;
        };
        assetByB: {
          code: string;
        };
        fee: string;
      };
    }[];
  };
  accountMergeByPublicKey: {
    edges: {
      node: {
        destination: string;
        destinationMuxed: string;
        source: string;
        sourceMuxed: string;
      };
    }[];
  };
  bumpSequenceByPublicKey: {
    edges: {
      node: {
        source: string;
        sourceMuxed: string;
        bumpTo: string;
      };
    }[];
  };
  claimClaimableBalanceByPublicKey: {
    edges: {
      node: {
        source: string;
        sourceMuxed: string;
        balanceId: string;
      };
    }[];
  };
  createClaimableBalanceByPublicKey: {
    edges: {
      node: {
        amount: string;
        asset: string;
        assetNative: boolean;
        source: string;
        sourceMuxed: string;
      };
    }[];
  };
}

const transformAccountHistory = (
  rawResponse: OperationResult<MercuryAccountHistory>
) => {
  const transferFromEdges = rawResponse.data?.transferFromEvent.edges || [];
  const transferToEdges = rawResponse.data?.transferToEvent.edges || [];
  const mintEdges = rawResponse.data?.mintEvent.edges || [];
  const createAccountEdges =
    rawResponse.data?.createAccountByPublicKey.edges || [];
  const createAccountToEdges =
    rawResponse.data?.createAccountToPublicKey.edges || [];
  const paymentsByPublicKeyEdges =
    rawResponse.data?.paymentsByPublicKey.edges || [];
  const paymentsToPublicKeyEdges =
    rawResponse.data?.paymentsToPublicKey.edges || [];
  const pathPaymentsStrictSendByPublicKeyEdges =
    rawResponse.data?.pathPaymentsStrictSendByPublicKey.nodes || [];
  const pathPaymentsStrictSendToPublicKeyEdges =
    rawResponse.data?.pathPaymentsStrictSendToPublicKey.nodes || [];
  const pathPaymentsStrictReceiveByPublicKeyEdges =
    rawResponse.data?.pathPaymentsStrictReceiveByPublicKey.nodes || [];
  const pathPaymentsStrictReceiveToPublicKeyEdges =
    rawResponse.data?.pathPaymentsStrictReceiveToPublicKey.nodes || [];
  const manageBuyOfferByPublicKeyEdges =
    rawResponse.data?.manageBuyOfferByPublicKey.edges || [];
  const manageSellOfferByPublicKeyEdges =
    rawResponse.data?.manageSellOfferByPublicKey.edges || [];
  const createPassiveSellOfferByPublicKeyEdges =
    rawResponse.data?.createPassiveSellOfferByPublicKey.nodes || [];
  const changeTrustByPublicKeyEdges =
    rawResponse.data?.changeTrustByPublicKey.nodes || [];
  const accountMergeByPublicKeyEdges =
    rawResponse.data?.accountMergeByPublicKey.edges || [];
  const bumpSequenceByPublicKeyEdges =
    rawResponse.data?.bumpSequenceByPublicKey.edges || [];
  const claimClaimableBalanceByPublicKeyEdges =
    rawResponse.data?.claimClaimableBalanceByPublicKey.edges || [];
  const createClaimableBalanceByPublicKeyEdges =
    rawResponse.data?.createClaimableBalanceByPublicKey.edges || [];

  const transferFrom = transferFromEdges.map((edge) => {
    const amountBigInt = scValToNative(
      xdr.ScVal.fromXDR(edge.node.data, "base64")
    ) as BigInt;
    return {
      contractId: edge.node.contractId,
      to: scValToNative(xdr.ScVal.fromXDR(edge.node.topic3, "base64")),
      from: scValToNative(xdr.ScVal.fromXDR(edge.node.topic2, "base64")),
      amount: amountBigInt.toString(),
    };
  });

  const transferTo = transferToEdges.map((edge) => {
    const amountBigInt = scValToNative(
      xdr.ScVal.fromXDR(edge.node.data, "base64")
    ) as BigInt;
    return {
      contractId: edge.node.contractId,
      to: scValToNative(xdr.ScVal.fromXDR(edge.node.topic3, "base64")),
      from: scValToNative(xdr.ScVal.fromXDR(edge.node.topic2, "base64")),
      amount: amountBigInt.toString(),
    };
  });

  const mint = mintEdges.map((edge) => {
    const amountBigInt = scValToNative(
      xdr.ScVal.fromXDR(edge.node.data, "base64")
    ) as BigInt;
    return {
      contractId: edge.node.contractId,
      to: scValToNative(xdr.ScVal.fromXDR(edge.node.topic1, "base64")),
      amount: amountBigInt.toString(),
    };
  });

  const createAccount = createAccountEdges.map((edge) => ({
    destination: edge.node.destination,
  }));

  const createAccountTo = createAccountToEdges.map((edge) => ({
    destination: edge.node.destination,
  }));

  const paymentsByPublicKey = paymentsByPublicKeyEdges.map((edge) => ({
    ...edge.node,
  }));

  const paymentsToPublicKey = paymentsToPublicKeyEdges.map((edge) => ({
    ...edge.node,
  }));

  const pathPaymentsStrictSendByPublicKey =
    pathPaymentsStrictSendByPublicKeyEdges.map((edge) => ({
      ...edge,
    }));

  const pathPaymentsStrictSendToPublicKey =
    pathPaymentsStrictSendToPublicKeyEdges.map((edge) => ({
      ...edge,
    }));

  const pathPaymentsStrictReceiveByPublicKey =
    pathPaymentsStrictReceiveByPublicKeyEdges.map((edge) => ({
      ...edge,
    }));

  const pathPaymentsStrictReceiveToPublicKey =
    pathPaymentsStrictReceiveToPublicKeyEdges.map((edge) => ({
      ...edge,
    }));

  const manageBuyOfferByPublicKey = manageBuyOfferByPublicKeyEdges.map(
    (edge) => ({
      ...edge,
    })
  );

  const manageSellOfferByPublicKey = manageSellOfferByPublicKeyEdges.map(
    (edge) => ({
      ...edge,
    })
  );

  const createPassiveSellOfferByPublicKey =
    createPassiveSellOfferByPublicKeyEdges.map((edge) => ({
      ...edge,
    }));

  const changeTrustByPublicKey = changeTrustByPublicKeyEdges.map((edge) => ({
    ...edge,
  }));

  const accountMergeByPublicKey = accountMergeByPublicKeyEdges.map((edge) => ({
    ...edge,
  }));

  const bumpSequenceByPublicKey = bumpSequenceByPublicKeyEdges.map((edge) => ({
    ...edge,
  }));

  const claimClaimableBalanceByPublicKey =
    claimClaimableBalanceByPublicKeyEdges.map((edge) => ({
      ...edge,
    }));

  const createClaimableBalanceByPublicKey =
    createClaimableBalanceByPublicKeyEdges.map((edge) => ({
      ...edge,
    }));

  return [
    ...transferFrom,
    ...mint,
    ...transferTo,
    ...createAccount,
    ...createAccountTo,
    ...paymentsByPublicKey,
    ...paymentsToPublicKey,
    ...pathPaymentsStrictSendByPublicKey,
    ...pathPaymentsStrictSendToPublicKey,
    ...pathPaymentsStrictReceiveByPublicKey,
    ...pathPaymentsStrictReceiveToPublicKey,
    ...manageBuyOfferByPublicKey,
    ...manageSellOfferByPublicKey,
    ...createPassiveSellOfferByPublicKey,
    ...changeTrustByPublicKey,
    ...accountMergeByPublicKey,
    ...bumpSequenceByPublicKey,
    ...claimClaimableBalanceByPublicKey,
    ...createClaimableBalanceByPublicKey,
  ];
};

export { transformAccountBalances, transformAccountHistory };
