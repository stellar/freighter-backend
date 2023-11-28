import { OperationResult } from "@urql/core";
import { scValToNative, xdr } from "stellar-sdk";
import BigNumber from "bignumber.js";
import {
  BASE_RESERVE,
  BASE_RESERVE_MIN_COUNT,
  NativeBalance,
} from "../../../helper/horizon-rpc";

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
      total: new BigNumber(accountObject.nativeBalance),
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
    prev[`${curr.assetByAsset.code}:${curr.assetByAsset.issuer}`] = {
      token: {
        code: curr.assetByAsset.code,
        issuer: {
          key: curr.assetByAsset.issuer,
        },
      },
      decimals: "7",
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

export { transformAccountBalances };
