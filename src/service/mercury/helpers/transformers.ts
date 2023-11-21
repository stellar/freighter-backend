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
}

const transformAccountHistory = (
  rawResponse: OperationResult<MercuryAccountHistory>
) => {
  const edges = rawResponse.data?.transferFromEvent.edges || [];
  const transferFrom = edges.map((edge) => {
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

  return [...transferFrom];
};

export { transformAccountBalances, transformAccountHistory };
