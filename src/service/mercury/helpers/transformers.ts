import { OperationResult } from "@urql/core";
import { scValToNative, xdr } from "soroban-client";
import BigNumber from "bignumber.js";
import { NativeBalance } from "../../../helper/horizon-rpc";

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
  const data = rawResponse?.data?.entryUpdateByContractIdAndKey.nodes || [];
  const formattedBalances = data.map((entry) => {
    const details = tokenDetails[entry.contractId];
    const totalScVal = xdr.ScVal.fromXDR(Buffer.from(entry.valueXdr, "base64"));
    return {
      ...entry,
      ...details,
      total: scValToNative(totalScVal),
    };
  });

  const balances = formattedBalances.reduce((prev, curr) => {
    if (curr.symbol === "XLM") {
      prev["native"] = {
        token: { type: "native", code: "XLM" },
        total: new BigNumber(curr.total),
        available: new BigNumber(curr.total), // TODO: how to get available for xlm?
      } as NativeBalance;
    }
    if (curr.contractId) {
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
    }
    return prev;
  }, {} as NonNullable<AccountBalancesInterface["balances"]>);

  return {
    balances,
    isFunded: true,
    subentryCount: 0, // TODO: Mercury will index this with account subs, and will add to query
  };
};

export { transformAccountBalances };
