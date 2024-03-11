import { OperationResult } from "@urql/core";
import { Horizon, StrKey, scValToNative, xdr } from "stellar-sdk";
import BigNumber from "bignumber.js";
import {
  BASE_RESERVE,
  BASE_RESERVE_MIN_COUNT,
  NativeBalance,
  getAssetType,
} from "../../../helper/horizon-rpc";
import { formatTokenAmount } from "../../../helper/format";
import { getOpArgs } from "../../../helper/soroban-rpc";

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
      numSponsored: string;
      numSponsoring: string;
      sellingLiabilities: string;
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
  const numSubEntries = accountObject.numSubEntries || "0";
  const numSponsoring = accountObject.numSponsoring || "0";
  const numSponsored = accountObject.numSponsored || "0";
  const sellingLiabilities = accountObject.sellingLiabilities || "0";

  const accountBalance = {
    native: {
      token: { type: "native", code: "XLM" },
      total: formatTokenAmount(new BigNumber(accountObject.nativeBalance), 7),
      available: new BigNumber(BASE_RESERVE_MIN_COUNT)
        .plus(new BigNumber(numSubEntries))
        .plus(new BigNumber(numSponsoring))
        .minus(new BigNumber(numSponsored))
        .times(new BigNumber(BASE_RESERVE))
        .plus(new BigNumber(sellingLiabilities)),
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
    const codeAscii = atob(curr.assetByAsset.code);
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
  invokeHostFnByPublicKey: {
    edges: {
      node: {
        auth: string;
        hostFunction: string;
        sorobanMeta: string;
        accountBySource: {
          publickey: string;
        };
        tx: string;
        opId: string;
        txInfoByTx: {
          fee: string;
          opCount: number;
          ledgerByLedger: {
            closeTime: number;
          };
        };
      };
    }[];
  };
  createAccountByPublicKey: {
    edges: {
      node: {
        accountByDestination: {
          publickey: string;
        };
        startingBalance: string;
        opId: string;
        txInfoByTx: {
          fee: string;
          opCount: number;
          ledgerByLedger: {
            closeTime: number;
          };
        };
      };
    }[];
  };
  createAccountToPublicKey: {
    edges: {
      node: {
        accountByDestination: {
          publickey: string;
        };
        startingBalance: string;
        opId: string;
        txInfoByTx: {
          fee: string;
          opCount: number;
          ledgerByLedger: {
            closeTime: number;
          };
        };
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
        opId: string;
        txInfoByTx: {
          fee: string;
          opCount: number;
          ledgerByLedger: {
            closeTime: number;
          };
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
        opId: string;
        txInfoByTx: {
          fee: string;
          opCount: number;
          ledgerByLedger: {
            closeTime: number;
          };
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
      opId: string;
      txInfoByTx: {
        fee: string;
        opCount: number;
        ledgerByLedger: {
          closeTime: number;
        };
      };
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
      opId: string;
      txInfoByTx: {
        fee: string;
        opCount: number;
        ledgerByLedger: {
          closeTime: number;
        };
      };
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
      destAmount: string;
      sendAssetNative: string;
      opId: string;
      txInfoByTx: {
        fee: string;
        opCount: number;
        ledgerByLedger: {
          closeTime: number;
        };
      };
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
      destAmount: string;
      sendAssetNative: string;
      opId: string;
      txInfoByTx: {
        fee: string;
        opCount: number;
        ledgerByLedger: {
          closeTime: number;
        };
      };
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
          closeTime: number;
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
        opId: string;
        txInfoByTx: {
          fee: string;
          opCount: number;
          ledgerByLedger: {
            closeTime: number;
          };
        };
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
          closeTime: number;
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
        opId: string;
        txInfoByTx: {
          fee: string;
          opCount: number;
          ledgerByLedger: {
            closeTime: number;
          };
        };
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
        closeTime: number;
        sequence: string;
      };
      muxedaccountBySourceMuxed: {
        id: string;
        publickey: string;
      };
      priceD: string;
      priceN: string;
      sellingNative: boolean;
      opId: string;
      txInfoByTx: {
        fee: string;
        opCount: number;
        ledgerByLedger: {
          closeTime: number;
        };
      };
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
      opId: string;
      txInfoByTx: {
        fee: string;
        opCount: number;
        ledgerByLedger: {
          closeTime: number;
          sequence: string;
        };
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
        opId: string;
        txInfoByTx: {
          fee: string;
          opCount: number;
          ledgerByLedger: {
            closeTime: number;
          };
        };
      };
    }[];
  };
  bumpSequenceByPublicKey: {
    edges: {
      node: {
        source: string;
        sourceMuxed: string;
        bumpTo: string;
        opId: string;
        txInfoByTx: {
          fee: string;
          opCount: number;
          ledgerByLedger: {
            closeTime: number;
          };
        };
      };
    }[];
  };
  claimClaimableBalanceByPublicKey: {
    edges: {
      node: {
        source: string;
        sourceMuxed: string;
        balanceId: string;
        opId: string;
        txInfoByTx: {
          fee: string;
          opCount: number;
          ledgerByLedger: {
            closeTime: number;
          };
        };
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
        opId: string;
        txInfoByTx: {
          fee: string;
          opCount: number;
          ledgerByLedger: {
            closeTime: number;
          };
        };
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
        opId: string;
        txInfoByTx: {
          fee: string;
          opCount: number;
          ledgerByLedger: {
            closeTime: number;
          };
        };
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
        opId: string;
        txInfoByTx: {
          fee: string;
          opCount: number;
          ledgerByLedger: {
            closeTime: number;
          };
        };
      };
    }[];
  };
  beginSponsoringFutureReservesByPublicKey: {
    edges: {
      node: {
        source: string;
        sourceMuxed: string;
        opId: string;
        txInfoByTx: {
          fee: string;
          opCount: number;
          ledgerByLedger: {
            closeTime: number;
          };
        };
      };
    }[];
  };
  endSponsoringFutureReservesByPublicKey: {
    edges: {
      node: {
        source: string;
        sourceMuxed: string;
        opId: string;
        txInfoByTx: {
          fee: string;
          opCount: number;
          ledgerByLedger: {
            closeTime: number;
          };
        };
      };
    }[];
  };
  revokeSponsorshipByPublicKey: {
    edges: {
      node: {
        source: string;
        sourceMuxed: string;
        sponsorship: string;
        opId: string;
        txInfoByTx: {
          fee: string;
          opCount: number;
          ledgerByLedger: {
            closeTime: number;
          };
        };
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
        opId: string;
        txInfoByTx: {
          fee: string;
          opCount: number;
          ledgerByLedger: {
            closeTime: number;
          };
        };
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
        opId: string;
        txInfoByTx: {
          fee: string;
          opCount: number;
          ledgerByLedger: {
            closeTime: number;
          };
        };
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
        opId: string;
        txInfoByTx: {
          fee: string;
          opCount: number;
          ledgerByLedger: {
            closeTime: number;
          };
        };
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
        opId: string;
        txInfoByTx: {
          fee: string;
          opCount: number;
          ledgerByLedger: {
            closeTime: number;
          };
        };
      };
    }[];
  };
}

const transformAccountHistory = async (
  rawResponse: OperationResult<MercuryAccountHistory>
): Promise<Partial<Horizon.ServerApi.OperationRecord>[]> => {
  const invokeHostFnEdges =
    rawResponse.data?.invokeHostFnByPublicKey.edges || [];
  const invokeHostFn = invokeHostFnEdges
    .filter((edge) => {
      // we only want to keep these history entries if the Host Fn is
      // for invoking a contract, we dont show contract create or wasm upload in wallet history right now.
      try {
        const hostFn = xdr.HostFunction.fromXDR(
          Buffer.from(edge.node.hostFunction, "base64")
        );
        hostFn.invokeContract();
        return true;
      } catch (error) {
        return false;
      }
    })
    .map((edge) => {
      const hostFn = xdr.HostFunction.fromXDR(
        Buffer.from(edge.node.hostFunction, "base64")
      );

      const invocation = hostFn.invokeContract();
      const fnName = invocation.functionName().toString();
      return {
        auth: edge.node.auth,
        created_at: new Date(
          edge.node.txInfoByTx.ledgerByLedger.closeTime * 1000
        ).toISOString(),
        sorobanMeta: edge.node.sorobanMeta,
        source_account: edge.node.accountBySource.publickey,
        tx: edge.node.tx,
        type: "invoke_host_function",
        type_i: 24,
        id: edge.node.opId,
        transaction_attr: {
          contractId: StrKey.encodeContract(
            invocation.contractAddress().contractId()
          ),
          fnName,
          args: getOpArgs(fnName, invocation.args()),
          operation_count: edge.node.txInfoByTx.opCount,
          fee_charged: edge.node.txInfoByTx.fee,
        },
      } as Partial<Horizon.ServerApi.InvokeHostFunctionOperationRecord>;
    });

  const createAccountEdges =
    rawResponse.data?.createAccountByPublicKey.edges || [];
  const createAccount = createAccountEdges.map(
    (edge) =>
      ({
        account: edge.node.accountByDestination.publickey,
        created_at: new Date(
          edge.node.txInfoByTx.ledgerByLedger.closeTime * 1000
        ).toISOString(),
        starting_balance: formatTokenAmount(
          new BigNumber(edge.node.startingBalance),
          7
        ),
        type: "create_account",
        type_i: 0,
        id: edge.node.opId,
        transaction_attr: {
          operation_count: edge.node.txInfoByTx.opCount,
          fee_charged: edge.node.txInfoByTx.fee,
        },
      } as Partial<Horizon.ServerApi.CreateAccountOperationRecord>)
  );

  const createAccountToEdges =
    rawResponse.data?.createAccountToPublicKey.edges || [];
  const createAccountTo = createAccountToEdges.map(
    (edge) =>
      ({
        account: edge.node.accountByDestination.publickey,
        created_at: new Date(
          edge.node.txInfoByTx.ledgerByLedger.closeTime * 1000
        ).toISOString(),
        starting_balance: formatTokenAmount(
          new BigNumber(edge.node.startingBalance),
          7
        ),
        type: "create_account",
        type_i: 0,
        id: edge.node.opId,
        transaction_attr: {
          operation_count: edge.node.txInfoByTx.opCount,
          fee_charged: edge.node.txInfoByTx.fee,
        },
      } as Partial<Horizon.ServerApi.CreateAccountOperationRecord>)
  );

  const paymentsByPublicKeyEdges =
    rawResponse.data?.paymentsByPublicKey.edges || [];
  const paymentsByPublicKey = paymentsByPublicKeyEdges.map((edge) => {
    const code = edge.node.assetByAsset
      ? getAssetType(atob(edge.node.assetByAsset?.code!))
      : null;
    const issuer = edge.node.assetByAsset
      ? edge.node.assetByAsset.issuer
      : null;
    return {
      created_at: new Date(
        edge.node.txInfoByTx.ledgerByLedger.closeTime * 1000
      ).toISOString(),
      from: edge.node.accountBySource.publickey,
      to: edge.node.accountByDestination.publickey,
      asset_type: code,
      asset_code: code,
      asset_issuer: issuer,
      amount: formatTokenAmount(new BigNumber(edge.node.amount), 7),
      type: "payment",
      type_i: 1,
      id: edge.node.opId,
      transaction_attr: {
        operation_count: edge.node.txInfoByTx.opCount,
        fee_charged: edge.node.txInfoByTx.fee,
      },
    } as Partial<Horizon.ServerApi.PaymentOperationRecord>;
  });

  const paymentsToPublicKeyEdges =
    rawResponse.data?.paymentsToPublicKey.edges || [];
  const paymentsToPublicKey = paymentsToPublicKeyEdges.map((edge) => {
    const code = edge.node.assetByAsset
      ? atob(edge.node.assetByAsset?.code!)
      : null;
    const issuer = edge.node.assetByAsset
      ? edge.node.assetByAsset.issuer
      : null;
    return {
      created_at: new Date(
        edge.node.txInfoByTx.ledgerByLedger.closeTime * 1000
      ).toISOString(),
      from: edge.node.accountBySource.publickey,
      to: edge.node.accountByDestination.publickey,
      asset_type: code,
      asset_code: code,
      asset_issuer: issuer,
      amount: formatTokenAmount(new BigNumber(edge.node.amount), 7),
      type: "payment",
      type_i: 1,
      id: edge.node.opId,
      transaction_attr: {
        operation_count: edge.node.txInfoByTx.opCount,
        fee_charged: edge.node.txInfoByTx.fee,
      },
    } as Partial<Horizon.ServerApi.PaymentOperationRecord>;
  });

  const pathPaymentsStrictSendByPublicKeyEdges =
    rawResponse.data?.pathPaymentsStrictSendByPublicKey.nodes || [];
  const pathPaymentsStrictSendByPublicKey =
    pathPaymentsStrictSendByPublicKeyEdges.map((edge) => {
      const code = atob(edge.assetByDestAsset.code);
      return {
        ...edge,
        created_at: new Date(
          edge.txInfoByTx.ledgerByLedger.closeTime * 1000
        ).toISOString(),
        type: "path_payment_strict_send",
        type_i: 13,
        id: edge.opId,
        transaction_attr: {
          operation_count: edge.txInfoByTx.opCount,
          fee_charged: edge.txInfoByTx.fee,
        },
        asset_code: code,
        asset_issuer: edge.assetByDestAsset.issuer,
        asset_type: getAssetType(code),
        source_account: edge.accountBySource.publickey,
        from: edge.accountBySource.publickey,
        to: edge.accountByDestination.publickey,
        destination_min: edge.destMin,
        amount: edge.sendAmount,
      } as Partial<Horizon.ServerApi.PathPaymentStrictSendOperationRecord>;
    });

  const pathPaymentsStrictSendToPublicKeyEdges =
    rawResponse.data?.pathPaymentsStrictSendToPublicKey.nodes || [];
  const pathPaymentsStrictSendToPublicKey =
    pathPaymentsStrictSendToPublicKeyEdges.map((edge) => {
      const code = atob(edge.assetByDestAsset.code);
      return {
        ...edge,
        created_at: new Date(
          edge.txInfoByTx.ledgerByLedger.closeTime * 1000
        ).toISOString(),
        type: "path_payment_strict_send",
        type_i: 13,
        id: edge.opId,
        transaction_attr: {
          operation_count: edge.txInfoByTx.opCount,
          fee_charged: edge.txInfoByTx.fee,
        },
        asset_code: code,
        asset_issuer: edge.assetByDestAsset.issuer,
        asset_type: getAssetType(code),
        source_account: edge.accountBySource.publickey,
        from: edge.accountBySource.publickey,
        to: edge.accountByDestination.publickey,
        destination_min: edge.destMin,
        amount: edge.sendAmount,
      } as Partial<Horizon.ServerApi.PathPaymentStrictSendOperationRecord>;
    });

  const pathPaymentsStrictReceiveByPublicKeyEdges =
    rawResponse.data?.pathPaymentsStrictReceiveByPublicKey.nodes || [];
  const pathPaymentsStrictReceiveByPublicKey =
    pathPaymentsStrictReceiveByPublicKeyEdges.map((edge) => {
      const code = edge.assetByDestAsset.code;
      return {
        ...edge,
        created_at: new Date(
          edge.txInfoByTx.ledgerByLedger.closeTime * 1000
        ).toISOString(),
        type: "path_payment_strict_receive",
        type_i: 2,
        id: edge.opId,
        transaction_attr: {
          operation_count: edge.txInfoByTx.opCount,
          fee_charged: edge.txInfoByTx.fee,
        },
        asset_code: code,
        asset_issuer: edge.assetByDestAsset.issuer,
        asset_type: getAssetType(code),
        source_account: edge.accountBySource.publickey,
        from: edge.accountBySource.publickey,
        to: edge.accountByDestination.publickey,
        destination_min: edge.destMin,
        amount: edge.destAmount,
      } as Partial<Horizon.ServerApi.PathPaymentOperationRecord>;
    });

  const pathPaymentsStrictReceiveToPublicKeyEdges =
    rawResponse.data?.pathPaymentsStrictReceiveToPublicKey.nodes || [];
  const pathPaymentsStrictReceiveToPublicKey =
    pathPaymentsStrictReceiveToPublicKeyEdges.map((edge) => {
      const code = edge.assetByDestAsset.code;
      return {
        ...edge,
        created_at: new Date(
          edge.txInfoByTx.ledgerByLedger.closeTime * 1000
        ).toISOString(),
        type: "path_payment_strict_receive",
        type_i: 2,
        id: edge.opId,
        transaction_attr: {
          operation_count: edge.txInfoByTx.opCount,
          fee_charged: edge.txInfoByTx.fee,
        },
        asset_code: code,
        asset_issuer: edge.assetByDestAsset.issuer,
        asset_type: getAssetType(code),
        source_account: edge.accountBySource.publickey,
        from: edge.accountBySource.publickey,
        to: edge.accountByDestination.publickey,
        destination_min: edge.destMin,
        amount: edge.destAmount,
      } as Partial<Horizon.ServerApi.PathPaymentOperationRecord>;
    });

  const manageBuyOfferByPublicKeyEdges =
    rawResponse.data?.manageBuyOfferByPublicKey.edges || [];
  const manageBuyOfferByPublicKey = manageBuyOfferByPublicKeyEdges.map(
    (edge) =>
      ({
        ...edge.node,
        created_at: new Date(
          edge.node.txInfoByTx.ledgerByLedger.closeTime * 1000
        ).toISOString(),
        type: "manage_sell_offer",
        type_i: 4,
        id: edge.node.opId,
        transaction_attr: {
          operation_count: edge.node.txInfoByTx.opCount,
          fee_charged: edge.node.txInfoByTx.fee,
        },
      } as Partial<Horizon.ServerApi.ManageOfferOperationRecord>)
  );

  const manageSellOfferByPublicKeyEdges =
    rawResponse.data?.manageSellOfferByPublicKey.edges || [];
  const manageSellOfferByPublicKey = manageSellOfferByPublicKeyEdges.map(
    (edge) =>
      ({
        ...edge.node,
        created_at: new Date(
          edge.node.txInfoByTx.ledgerByLedger.closeTime * 1000
        ).toISOString(),
        type: "manage_sell_offer",
        type_i: 4,
        id: edge.node.opId,
        transaction_attr: {
          operation_count: edge.node.txInfoByTx.opCount,
          fee_charged: edge.node.txInfoByTx.fee,
        },
      } as Partial<Horizon.ServerApi.ManageOfferOperationRecord>)
  );

  const createPassiveSellOfferByPublicKeyEdges =
    rawResponse.data?.createPassiveSellOfferByPublicKey.nodes || [];
  const createPassiveSellOfferByPublicKey =
    createPassiveSellOfferByPublicKeyEdges.map(
      (edge) =>
        ({
          ...edge,
          created_at: new Date(
            edge.txInfoByTx.ledgerByLedger.closeTime * 1000
          ).toISOString(),
          type: "create_passive_sell_offer",
          type_i: 3,
          id: edge.opId,
          transaction_attr: {
            operation_count: edge.txInfoByTx.opCount,
            fee_charged: edge.txInfoByTx.fee,
          },
        } as Partial<Horizon.ServerApi.PassiveOfferOperationRecord>)
    );

  const changeTrustByPublicKeyEdges =
    rawResponse.data?.changeTrustByPublicKey.nodes || [];
  const changeTrustByPublicKey = changeTrustByPublicKeyEdges.map(
    (edge) =>
      ({
        ...edge,
        created_at: new Date(
          edge.txInfoByTx.ledgerByLedger.closeTime * 1000
        ).toISOString(),
        type: "change_trust",
        type_i: 6,
        id: edge.opId,
        transaction_attr: {
          operation_count: edge.txInfoByTx.opCount,
          fee_charged: edge.txInfoByTx.fee,
        },
      } as Partial<Horizon.ServerApi.ChangeTrustOperationRecord>)
  );

  const accountMergeByPublicKeyEdges =
    rawResponse.data?.accountMergeByPublicKey.edges || [];
  const accountMergeByPublicKey = accountMergeByPublicKeyEdges.map(
    (edge) =>
      ({
        ...edge.node,
        created_at: new Date(
          edge.node.txInfoByTx.ledgerByLedger.closeTime * 1000
        ).toISOString(),
        type: "account_merge",
        type_i: 8,
        id: edge.node.opId,
        transaction_attr: {
          operation_count: edge.node.txInfoByTx.opCount,
          fee_charged: edge.node.txInfoByTx.fee,
        },
      } as Partial<Horizon.ServerApi.AccountMergeOperationRecord>)
  );

  const bumpSequenceByPublicKeyEdges =
    rawResponse.data?.bumpSequenceByPublicKey.edges || [];
  const bumpSequenceByPublicKey = bumpSequenceByPublicKeyEdges.map(
    (edge) =>
      ({
        ...edge.node,
        created_at: new Date(
          edge.node.txInfoByTx.ledgerByLedger.closeTime * 1000
        ).toISOString(),
        type: "bump_sequence",
        type_i: 11,
        id: edge.node.opId,
        transaction_attr: {
          operation_count: edge.node.txInfoByTx.opCount,
          fee_charged: edge.node.txInfoByTx.fee,
        },
      } as Partial<Horizon.ServerApi.BumpSequenceOperationRecord>)
  );

  const claimClaimableBalanceByPublicKeyEdges =
    rawResponse.data?.claimClaimableBalanceByPublicKey.edges || [];
  const claimClaimableBalanceByPublicKey =
    claimClaimableBalanceByPublicKeyEdges.map(
      (edge) =>
        ({
          ...edge.node,
          created_at: new Date(
            edge.node.txInfoByTx.ledgerByLedger.closeTime * 1000
          ).toISOString(),
          type: "claim_claimable_balance",
          type_i: 15,
          id: edge.node.opId,
          transaction_attr: {
            operation_count: edge.node.txInfoByTx.opCount,
            fee_charged: edge.node.txInfoByTx.fee,
          },
        } as Partial<Horizon.ServerApi.ClaimClaimableBalanceOperationRecord>)
    );

  const createClaimableBalanceByPublicKeyEdges =
    rawResponse.data?.createClaimableBalanceByPublicKey.edges || [];
  const createClaimableBalanceByPublicKey =
    createClaimableBalanceByPublicKeyEdges.map(
      (edge) =>
        ({
          ...edge.node,
          created_at: new Date(
            edge.node.txInfoByTx.ledgerByLedger.closeTime * 1000
          ).toISOString(),
          type: "create_claimable_balance",
          type_i: 14,
          id: edge.node.opId,
          transaction_attr: {
            operation_count: edge.node.txInfoByTx.opCount,
            fee_charged: edge.node.txInfoByTx.fee,
          },
        } as Partial<Horizon.ServerApi.CreateClaimableBalanceOperationRecord>)
    );

  const allowTrustByPublicKeyEdges =
    rawResponse.data?.allowTrustByPublicKey.edges || [];
  const allowTrustByPublicKey = allowTrustByPublicKeyEdges.map(
    (edge) =>
      ({
        ...edge.node,
        created_at: new Date(
          edge.node.txInfoByTx.ledgerByLedger.closeTime * 1000
        ).toISOString(),
        type: "allow_trust",
        type_i: 7,
        id: edge.node.opId,
        transaction_attr: {
          operation_count: edge.node.txInfoByTx.opCount,
          fee_charged: edge.node.txInfoByTx.fee,
        },
      } as Partial<Horizon.ServerApi.AllowTrustOperationRecord>)
  );

  const manageDataByPublicKeyEdges =
    rawResponse.data?.manageDataByPublicKey.edges || [];
  const manageDataByPublicKey = manageDataByPublicKeyEdges.map(
    (edge) =>
      ({
        ...edge.node,
        created_at: new Date(
          edge.node.txInfoByTx.ledgerByLedger.closeTime * 1000
        ).toISOString(),
        type: "manage_data",
        type_i: 10,
        id: edge.node.opId,
        transaction_attr: {
          operation_count: edge.node.txInfoByTx.opCount,
          fee_charged: edge.node.txInfoByTx.fee,
        },
      } as Partial<Horizon.ServerApi.ManageDataOperationRecord>)
  );

  const beginSponsoringFutureReservesByPublicKeyEdges =
    rawResponse.data?.beginSponsoringFutureReservesByPublicKey.edges || [];
  const beginSponsoringFutureReservesByPublicKey =
    beginSponsoringFutureReservesByPublicKeyEdges.map(
      (edge) =>
        ({
          ...edge.node,
          created_at: new Date(
            edge.node.txInfoByTx.ledgerByLedger.closeTime * 1000
          ).toISOString(),
          type: "begin_sponsoring_future_reserves",
          type_i: 16,
          id: edge.node.opId,
          transaction_attr: {
            operation_count: edge.node.txInfoByTx.opCount,
            fee_charged: edge.node.txInfoByTx.fee,
          },
        } as Partial<Horizon.ServerApi.BeginSponsoringFutureReservesOperationRecord>)
    );

  const endSponsoringFutureReservesByPublicKeyEdges =
    rawResponse.data?.endSponsoringFutureReservesByPublicKey.edges || [];
  const endSponsoringFutureReservesByPublicKey =
    endSponsoringFutureReservesByPublicKeyEdges.map(
      (edge) =>
        ({
          ...edge.node,
          created_at: new Date(
            edge.node.txInfoByTx.ledgerByLedger.closeTime * 1000
          ).toISOString(),
          type: "end_sponsoring_future_reserves",
          type_i: 17,
          id: edge.node.opId,
          transaction_attr: {
            operation_count: edge.node.txInfoByTx.opCount,
            fee_charged: edge.node.txInfoByTx.fee,
          },
        } as Partial<Horizon.ServerApi.EndSponsoringFutureReservesOperationRecord>)
    );

  const revokeSponsorshipByPublicKeyEdges =
    rawResponse.data?.revokeSponsorshipByPublicKey.edges || [];
  const revokeSponsorshipByPublicKey = revokeSponsorshipByPublicKeyEdges.map(
    (edge) =>
      ({
        ...edge.node,
        created_at: new Date(
          edge.node.txInfoByTx.ledgerByLedger.closeTime * 1000
        ).toISOString(),
        type: "revoke_sponsorship",
        type_i: 18,
        id: edge.node.opId,
        transaction_attr: {
          operation_count: edge.node.txInfoByTx.opCount,
          fee_charged: edge.node.txInfoByTx.fee,
        },
      } as Partial<Horizon.ServerApi.RevokeSponsorshipOperationRecord>)
  );

  const clawbackByPublicKeyEdges =
    rawResponse.data?.clawbackByPublicKey.edges || [];
  const clawbackByPublicKey = clawbackByPublicKeyEdges.map(
    (edge) =>
      ({
        ...edge.node,
        created_at: new Date(
          edge.node.txInfoByTx.ledgerByLedger.closeTime * 1000
        ).toISOString(),
        type: "clawback",
        type_i: 19,
        id: edge.node.opId,
        transaction_attr: {
          operation_count: edge.node.txInfoByTx.opCount,
          fee_charged: edge.node.txInfoByTx.fee,
        },
      } as Partial<Horizon.ServerApi.ClawbackOperationRecord>)
  );

  const setTrustLineFlagsByPublicKeyEdges =
    rawResponse.data?.setTrustLineFlagsByPublicKey.edges || [];
  const setTrustLineFlagsByPublicKey = setTrustLineFlagsByPublicKeyEdges.map(
    (edge) =>
      ({
        ...edge.node,
        created_at: new Date(
          edge.node.txInfoByTx.ledgerByLedger.closeTime * 1000
        ).toISOString(),
        type: "set_trust_line_flags",
        type_i: 21,
        id: edge.node.opId,
        transaction_attr: {
          operation_count: edge.node.txInfoByTx.opCount,
          fee_charged: edge.node.txInfoByTx.fee,
        },
      } as Partial<Horizon.ServerApi.SetTrustLineFlagsOperationRecord>)
  );

  const liquidityPoolDepositByPublicKeyEdges =
    rawResponse.data?.liquidityPoolDepositByPublicKey.edges || [];
  const liquidityPoolDepositByPublicKey =
    liquidityPoolDepositByPublicKeyEdges.map(
      (edge) =>
        ({
          ...edge.node,
          created_at: new Date(
            edge.node.txInfoByTx.ledgerByLedger.closeTime * 1000
          ).toISOString(),
          type: "liquidity_pool_deposit",
          type_i: 22,
          id: edge.node.opId,
          transaction_attr: {
            operation_count: edge.node.txInfoByTx.opCount,
            fee_charged: edge.node.txInfoByTx.fee,
          },
        } as Partial<Horizon.ServerApi.DepositLiquidityOperationRecord>)
    );

  const liquidityPoolWithdrawByPublicKeyEdges =
    rawResponse.data?.liquidityPoolWithdrawByPublicKey.edges || [];
  const liquidityPoolWithdrawByPublicKey =
    liquidityPoolWithdrawByPublicKeyEdges.map(
      (edge) =>
        ({
          ...edge.node,
          created_at: new Date(
            edge.node.txInfoByTx.ledgerByLedger.closeTime * 1000
          ).toISOString(),
          type: "liquidity_pool_withdraw",
          type_i: 23,
          id: edge.node.opId,
          transaction_attr: {
            operation_count: edge.node.txInfoByTx.opCount,
            fee_charged: edge.node.txInfoByTx.fee,
          },
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
    ...invokeHostFn,
  ].sort((a, b) => {
    const createdA = a.created_at!;
    const createdB = b.created_at!;
    return new Date(createdB).getTime() - new Date(createdA).getTime();
  }); // Mercury indexes first to last and sort is TODO
};

export { transformAccountBalances, transformAccountHistory };
