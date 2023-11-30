import { OperationResult } from "@urql/core";
import { Horizon, Networks, scValToNative, xdr } from "stellar-sdk";
import BigNumber from "bignumber.js";
import {
  BASE_RESERVE,
  BASE_RESERVE_MIN_COUNT,
  NativeBalance,
} from "../../../helper/horizon-rpc";
import { formatTokenAmount } from "../../../helper/format";

type NetworkNames = keyof typeof Networks;

// Transformers take an API response, and transform it/augment it for frontend consumption

export interface BalanceMap {
  [key: string]: any;
  native: NativeBalance;
}

export type Balances = BalanceMap | null;

interface AccountBalancesInterface {
  balances: Balances;
  isFunded: boolean | null;
  subentryCount: number;
}

interface MercuryAccountBalancesData {
  accountObjectByPublicKey: {
    nodes: {
      accountByAccount: {
        publickey: string;
      };
      nativeBalance: string;
      numSubEntries: string;
    }[];
  };
  balanceByPublicKey: {
    nodes: {
      assetByAsset: {
        code: string;
        issuer: string;
      };
      accountByAccount: {
        publickey: string;
      };
      balance: string;
    }[];
  };
  entryUpdateByContractIdAndKey?: {
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
  const tokenBalanceData =
    rawResponse?.data?.entryUpdateByContractIdAndKey?.nodes || [];
  const accountObjectData =
    rawResponse?.data?.accountObjectByPublicKey.nodes || [];
  const classicBalanceData = rawResponse?.data?.balanceByPublicKey.nodes || [];

  const accountObject = accountObjectData[0];
  // TODO: get these into query
  const numSponsoring = 0;
  const numSponsored = 0;
  const sellingLiabilities = 0;

  const accountBalance = {
    native: {
      token: { type: "native", code: "XLM" },
      total: formatTokenAmount(new BigNumber(accountObject.nativeBalance), 7),
      available: new BigNumber(BASE_RESERVE_MIN_COUNT)
        .plus(accountObject.numSubEntries)
        .plus(numSponsoring)
        .minus(numSponsored)
        .times(BASE_RESERVE)
        .plus(sellingLiabilities),
    },
  };

  const formattedBalances = tokenBalanceData.map((entry) => {
    const details = tokenDetails[entry.contractId];
    const totalScVal = xdr.ScVal.fromXDR(Buffer.from(entry.valueXdr, "base64"));
    return {
      ...entry,
      ...details,
      total: scValToNative(totalScVal),
    };
  });

  const balances = formattedBalances.reduce((prev, curr) => {
    prev[`${curr.symbol}:${curr.contractId}`] = {
      token: {
        code: curr.symbol,
        issuer: {
          key: curr.contractId,
        },
      },
      decimals: curr.decimals,
      total: new BigNumber(curr.total),
      available: new BigNumber(curr.total),
    };
    return prev;
  }, {} as NonNullable<AccountBalancesInterface["balances"]>);

  const classicBalances = classicBalanceData.reduce((prev, curr) => {
    const codeAscii = Buffer.from(
      curr.assetByAsset.code.substring(2),
      "hex"
    ).toString("utf8");
    prev[`${codeAscii}:${curr.assetByAsset.issuer}`] = {
      token: {
        code: codeAscii,
        issuer: {
          key: curr.assetByAsset.issuer,
        },
      },
      total: new BigNumber(curr.balance),
      available: new BigNumber(curr.balance),
    };
    return prev;
  }, {} as NonNullable<AccountBalancesInterface["balances"]>);

  return {
    balances: {
      ...accountBalance,
      ...classicBalances,
      ...balances,
    },
    isFunded: true,
    subentryCount: accountObject.numSubEntries,
  };
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
        startingBalance: string;
      };
    }[];
  };
  createAccountToPublicKey: {
    edges: {
      node: {
        destination: string;
        startingBalance: string;
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
        } | null;
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
        } | null;
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
  allowTrustByPublicKey: {
    edges: {
      node: {
        authorize: boolean;
        code: string;
        source: string;
        sourceMuxed: string;
        trustor: string;
      };
    }[];
  };
  manageDataByPublicKey: {
    edges: {
      node: {
        dataName: string;
        dataValue: string;
        source: string;
        sourceMuxed: string;
      };
    }[];
  };
  beginSponsoringFutureReservesByPublicKey: {
    edges: {
      node: {
        source: string;
        sourceMuxed: string;
      };
    }[];
  };
  endSponsoringFutureReservesByPublicKey: {
    edges: {
      node: {
        source: string;
        sourceMuxed: string;
      };
    }[];
  };
  revokeSponsorshipByPublicKey: {
    edges: {
      node: {
        source: string;
        sourceMuxed: string;
        sponsorship: string;
      };
    }[];
  };
  clawbackByPublicKey: {
    edges: {
      node: {
        amount: string;
        asset: string;
        assetNative: boolean;
        from: string;
        fromMuxed: string;
        source: string;
        sourceMuxed: string;
      };
    }[];
  };
  setTrustLineFlagsByPublicKey: {
    edges: {
      node: {
        asset: string;
        assetNative: boolean;
        clearFlags: boolean;
        setFlags: boolean;
        source: string;
        sourceMuxed: string;
        trustor: string;
      };
    }[];
  };
  liquidityPoolDepositByPublicKey: {
    edges: {
      node: {
        maxAmountA: string;
        maxAmountB: string;
        maxPriceD: string;
        maxPriceN: string;
        minPriceD: string;
        source: string;
        sourceMuxed: string;
      };
    }[];
  };
  liquidityPoolWithdrawByPublicKey: {
    edges: {
      node: {
        amount: string;
        minAmountA: string;
        minAmountB: string;
        source: string;
        sourceMuxed: string;
      };
    }[];
  };
}

const transformAccountHistory = async (
  rawResponse: OperationResult<MercuryAccountHistory>,
  pubKey: string,
  network: NetworkNames,
  getTokenDetails: any // todo
): Promise<Partial<Horizon.ServerApi.OperationRecord>[]> => {
  const transferFromEdges = rawResponse.data?.transferFromEvent.edges || [];
  const transferFrom = await Promise.all(
    transferFromEdges.map(async (edge) => {
      const tokenDetails = await getTokenDetails(
        pubKey,
        edge.node.contractId,
        network
      );
      const amountBigInt = scValToNative(
        xdr.ScVal.fromXDR(edge.node.data, "base64")
      ) as BigInt;
      return {
        source_account: pubKey,
        asset_issuer: edge.node.contractId,
        asset_code: tokenDetails.symbol,
        type: "invoke_host_function",
        type_i: 24,
        contractId: edge.node.contractId,
        fnName: scValToNative(xdr.ScVal.fromXDR(edge.node.topic1, "base64")),
        to: scValToNative(xdr.ScVal.fromXDR(edge.node.topic3, "base64")),
        from: scValToNative(xdr.ScVal.fromXDR(edge.node.topic2, "base64")),
        amount: amountBigInt.toString(),
      } as Partial<Horizon.ServerApi.InvokeHostFunctionOperationRecord>;
    })
  );

  const transferToEdges = rawResponse.data?.transferToEvent.edges || [];
  const transferTo = await Promise.all(
    transferToEdges.map(async (edge) => {
      const tokenDetails = await getTokenDetails(
        pubKey,
        edge.node.contractId,
        network
      );
      const amountBigInt = scValToNative(
        xdr.ScVal.fromXDR(edge.node.data, "base64")
      ) as BigInt;
      return {
        source_account: pubKey,
        asset_issuer: edge.node.contractId,
        asset_code: tokenDetails.symbol,
        type: "invoke_host_function",
        type_i: 24,
        contractId: edge.node.contractId,
        fnName: scValToNative(xdr.ScVal.fromXDR(edge.node.topic1, "base64")),
        to: scValToNative(xdr.ScVal.fromXDR(edge.node.topic3, "base64")),
        from: scValToNative(xdr.ScVal.fromXDR(edge.node.topic2, "base64")),
        amount: amountBigInt.toString(),
      } as Partial<Horizon.ServerApi.InvokeHostFunctionOperationRecord>;
    })
  );

  const mintEdges = rawResponse.data?.mintEvent.edges || [];
  const mint = await Promise.all(
    mintEdges.map(async (edge) => {
      const tokenDetails = await getTokenDetails(
        pubKey,
        edge.node.contractId,
        network
      );
      const amountBigInt = scValToNative(
        xdr.ScVal.fromXDR(edge.node.data, "base64")
      ) as BigInt;
      return {
        source_account: pubKey,
        asset_issuer: edge.node.contractId,
        asset_code: tokenDetails.symbol,
        type: "invoke_host_function",
        type_i: 24,
        contractId: edge.node.contractId,
        fnName: scValToNative(xdr.ScVal.fromXDR(edge.node.topic1, "base64")),
        to: scValToNative(xdr.ScVal.fromXDR(edge.node.topic2, "base64")),
        amount: amountBigInt.toString(),
      } as Partial<Horizon.ServerApi.InvokeHostFunctionOperationRecord>;
    })
  );

  const createAccountEdges =
    rawResponse.data?.createAccountByPublicKey.edges || [];
  const createAccount = createAccountEdges.map(
    (edge) =>
      ({
        destination: edge.node.destination,
        starting_balance: edge.node.startingBalance,
      } as Partial<Horizon.ServerApi.CreateAccountOperationRecord>)
  );

  const createAccountToEdges =
    rawResponse.data?.createAccountToPublicKey.edges || [];
  const createAccountTo = createAccountToEdges.map(
    (edge) =>
      ({
        destination: edge.node.destination,
        starting_balance: edge.node.startingBalance,
      } as Partial<Horizon.ServerApi.CreateAccountOperationRecord>)
  );

  const paymentsByPublicKeyEdges =
    rawResponse.data?.paymentsByPublicKey.edges || [];
  const paymentsByPublicKey = paymentsByPublicKeyEdges.map(
    (edge) =>
      ({
        from: edge.node.accountBySource.publickey,
        to: edge.node.accountByDestination.publickey,
        asset_type: undefined, // TODO, get asset type in Mercury
        asset_code: edge.node.assetByAsset?.code,
        asset_issuer: edge.node.assetByAsset?.code,
        amount: edge.node.amount,
      } as Partial<Horizon.ServerApi.PaymentOperationRecord>)
  );

  const paymentsToPublicKeyEdges =
    rawResponse.data?.paymentsToPublicKey.edges || [];
  const paymentsToPublicKey = paymentsToPublicKeyEdges.map(
    (edge) =>
      ({
        from: edge.node.accountBySource.publickey,
        to: edge.node.accountByDestination.publickey,
        asset_type: undefined, // TODO, get asset type in Mercury
        asset_code: edge.node.assetByAsset?.code,
        asset_issuer: edge.node.assetByAsset?.code,
        amount: edge.node.amount,
      } as Partial<Horizon.ServerApi.PaymentOperationRecord>)
  );

  const pathPaymentsStrictSendByPublicKeyEdges =
    rawResponse.data?.pathPaymentsStrictSendByPublicKey.nodes || [];
  const pathPaymentsStrictSendByPublicKey =
    pathPaymentsStrictSendByPublicKeyEdges.map(
      (edge) =>
        ({
          ...edge,
        } as Partial<Horizon.ServerApi.PathPaymentStrictSendOperationRecord>)
    );

  const pathPaymentsStrictSendToPublicKeyEdges =
    rawResponse.data?.pathPaymentsStrictSendToPublicKey.nodes || [];
  const pathPaymentsStrictSendToPublicKey =
    pathPaymentsStrictSendToPublicKeyEdges.map(
      (edge) =>
        ({
          ...edge,
        } as Partial<Horizon.ServerApi.PathPaymentStrictSendOperationRecord>)
    );

  const pathPaymentsStrictReceiveByPublicKeyEdges =
    rawResponse.data?.pathPaymentsStrictReceiveByPublicKey.nodes || [];
  const pathPaymentsStrictReceiveByPublicKey =
    pathPaymentsStrictReceiveByPublicKeyEdges.map(
      (edge) =>
        ({
          ...edge,
        } as Partial<Horizon.ServerApi.PathPaymentOperationRecord>)
    );

  const pathPaymentsStrictReceiveToPublicKeyEdges =
    rawResponse.data?.pathPaymentsStrictReceiveToPublicKey.nodes || [];
  const pathPaymentsStrictReceiveToPublicKey =
    pathPaymentsStrictReceiveToPublicKeyEdges.map(
      (edge) =>
        ({
          ...edge,
        } as Partial<Horizon.ServerApi.PathPaymentOperationRecord>)
    );

  const manageBuyOfferByPublicKeyEdges =
    rawResponse.data?.manageBuyOfferByPublicKey.edges || [];
  const manageBuyOfferByPublicKey = manageBuyOfferByPublicKeyEdges.map(
    (edge) =>
      ({
        ...edge.node,
      } as Partial<Horizon.ServerApi.ManageOfferOperationRecord>)
  );

  const manageSellOfferByPublicKeyEdges =
    rawResponse.data?.manageSellOfferByPublicKey.edges || [];
  const manageSellOfferByPublicKey = manageSellOfferByPublicKeyEdges.map(
    (edge) =>
      ({
        ...edge.node,
      } as Partial<Horizon.ServerApi.ManageOfferOperationRecord>)
  );

  const createPassiveSellOfferByPublicKeyEdges =
    rawResponse.data?.createPassiveSellOfferByPublicKey.nodes || [];
  const createPassiveSellOfferByPublicKey =
    createPassiveSellOfferByPublicKeyEdges.map(
      (edge) =>
        ({
          ...edge,
        } as Partial<Horizon.ServerApi.PassiveOfferOperationRecord>)
    );

  const changeTrustByPublicKeyEdges =
    rawResponse.data?.changeTrustByPublicKey.nodes || [];
  const changeTrustByPublicKey = changeTrustByPublicKeyEdges.map(
    (edge) =>
      ({
        ...edge,
      } as Partial<Horizon.ServerApi.ChangeTrustOperationRecord>)
  );

  const accountMergeByPublicKeyEdges =
    rawResponse.data?.accountMergeByPublicKey.edges || [];
  const accountMergeByPublicKey = accountMergeByPublicKeyEdges.map(
    (edge) =>
      ({
        ...edge.node,
      } as Partial<Horizon.ServerApi.AccountMergeOperationRecord>)
  );

  const bumpSequenceByPublicKeyEdges =
    rawResponse.data?.bumpSequenceByPublicKey.edges || [];
  const bumpSequenceByPublicKey = bumpSequenceByPublicKeyEdges.map(
    (edge) =>
      ({
        ...edge.node,
      } as Partial<Horizon.ServerApi.BumpSequenceOperationRecord>)
  );

  const claimClaimableBalanceByPublicKeyEdges =
    rawResponse.data?.claimClaimableBalanceByPublicKey.edges || [];
  const claimClaimableBalanceByPublicKey =
    claimClaimableBalanceByPublicKeyEdges.map(
      (edge) =>
        ({
          ...edge.node,
        } as Partial<Horizon.ServerApi.ClaimClaimableBalanceOperationRecord>)
    );

  const createClaimableBalanceByPublicKeyEdges =
    rawResponse.data?.createClaimableBalanceByPublicKey.edges || [];
  const createClaimableBalanceByPublicKey =
    createClaimableBalanceByPublicKeyEdges.map(
      (edge) =>
        ({
          ...edge.node,
        } as Partial<Horizon.ServerApi.CreateClaimableBalanceOperationRecord>)
    );

  const allowTrustByPublicKeyEdges =
    rawResponse.data?.allowTrustByPublicKey.edges || [];
  const allowTrustByPublicKey = allowTrustByPublicKeyEdges.map(
    (edge) =>
      ({
        ...edge.node,
      } as Partial<Horizon.ServerApi.AllowTrustOperationRecord>)
  );

  const manageDataByPublicKeyEdges =
    rawResponse.data?.manageDataByPublicKey.edges || [];
  const manageDataByPublicKey = manageDataByPublicKeyEdges.map(
    (edge) =>
      ({
        ...edge.node,
      } as Partial<Horizon.ServerApi.ManageDataOperationRecord>)
  );

  const beginSponsoringFutureReservesByPublicKeyEdges =
    rawResponse.data?.beginSponsoringFutureReservesByPublicKey.edges || [];
  const beginSponsoringFutureReservesByPublicKey =
    beginSponsoringFutureReservesByPublicKeyEdges.map(
      (edge) =>
        ({
          ...edge.node,
        } as Partial<Horizon.ServerApi.BeginSponsoringFutureReservesOperationRecord>)
    );

  const endSponsoringFutureReservesByPublicKeyEdges =
    rawResponse.data?.endSponsoringFutureReservesByPublicKey.edges || [];
  const endSponsoringFutureReservesByPublicKey =
    endSponsoringFutureReservesByPublicKeyEdges.map(
      (edge) =>
        ({
          ...edge.node,
        } as Partial<Horizon.ServerApi.EndSponsoringFutureReservesOperationRecord>)
    );

  const revokeSponsorshipByPublicKeyEdges =
    rawResponse.data?.revokeSponsorshipByPublicKey.edges || [];
  const revokeSponsorshipByPublicKey = revokeSponsorshipByPublicKeyEdges.map(
    (edge) =>
      ({
        ...edge.node,
      } as Partial<Horizon.ServerApi.RevokeSponsorshipOperationRecord>)
  );

  const clawbackByPublicKeyEdges =
    rawResponse.data?.clawbackByPublicKey.edges || [];
  const clawbackByPublicKey = clawbackByPublicKeyEdges.map(
    (edge) =>
      ({
        ...edge.node,
      } as Partial<Horizon.ServerApi.ClawbackOperationRecord>)
  );

  const setTrustLineFlagsByPublicKeyEdges =
    rawResponse.data?.setTrustLineFlagsByPublicKey.edges || [];
  const setTrustLineFlagsByPublicKey = setTrustLineFlagsByPublicKeyEdges.map(
    (edge) =>
      ({
        ...edge.node,
      } as Partial<Horizon.ServerApi.SetTrustLineFlagsOperationRecord>)
  );

  const liquidityPoolDepositByPublicKeyEdges =
    rawResponse.data?.liquidityPoolDepositByPublicKey.edges || [];
  const liquidityPoolDepositByPublicKey =
    liquidityPoolDepositByPublicKeyEdges.map(
      (edge) =>
        ({
          ...edge.node,
        } as Partial<Horizon.ServerApi.DepositLiquidityOperationRecord>)
    );

  const liquidityPoolWithdrawByPublicKeyEdges =
    rawResponse.data?.liquidityPoolWithdrawByPublicKey.edges || [];
  const liquidityPoolWithdrawByPublicKey =
    liquidityPoolWithdrawByPublicKeyEdges.map(
      (edge) =>
        ({
          ...edge.node,
        } as Partial<Horizon.ServerApi.WithdrawLiquidityOperationRecord>)
    );

  return [
    ...createAccount,
    ...createAccountTo,
    ...paymentsByPublicKey,
    ...paymentsToPublicKey,
    ...changeTrustByPublicKey,
    ...allowTrustByPublicKey,
    ...accountMergeByPublicKey,
    ...bumpSequenceByPublicKey,
    ...liquidityPoolDepositByPublicKey,
    ...liquidityPoolWithdrawByPublicKey,
    ...pathPaymentsStrictSendByPublicKey,
    ...pathPaymentsStrictSendToPublicKey,
    ...pathPaymentsStrictReceiveByPublicKey,
    ...pathPaymentsStrictReceiveToPublicKey,
    ...claimClaimableBalanceByPublicKey,
    ...createClaimableBalanceByPublicKey,
    ...manageBuyOfferByPublicKey,
    ...manageSellOfferByPublicKey,
    ...createPassiveSellOfferByPublicKey,
    ...manageDataByPublicKey,
    ...beginSponsoringFutureReservesByPublicKey,
    ...endSponsoringFutureReservesByPublicKey,
    ...revokeSponsorshipByPublicKey,
    ...clawbackByPublicKey,
    ...setTrustLineFlagsByPublicKey,
    ...transferTo,
    ...transferFrom,
    ...mint,
  ];
};

export { transformAccountBalances, transformAccountHistory };
