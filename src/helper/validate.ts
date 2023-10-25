import { StrKey } from "soroban-client";

const isContractId = (contractId: string) => {
  try {
    StrKey.decodeContract(contractId);
    return true;
  } catch (error) {
    return false;
  }
};

export { isContractId };
