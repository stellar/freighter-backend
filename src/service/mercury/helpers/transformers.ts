import { OperationResult } from "@urql/core";

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

interface MercuryAllEntryUpdatesData {
  allEntryUpdates: {
    nodes: {
      contractId: string;
      nodeId: string;
      id: string;
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

const transformEntryUpdates = async (
  rawResponse: OperationResult<MercuryAllEntryUpdatesData>
) => {
  return rawResponse?.data?.allEntryUpdates.nodes.map((node) => node);
};

export { transformAccountBalances, transformEntryUpdates };
