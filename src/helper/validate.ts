import { Networks, StrKey } from "stellar-sdk";

export type NetworkNames = keyof typeof Networks;

const isContractId = (contractId: string) => {
  try {
    StrKey.decodeContract(contractId);
    return true;
  } catch (error) {
    return false;
  }
};

const isPubKey = (pubKey: string) => {
  try {
    StrKey.decodeEd25519PublicKey(pubKey);
    return true;
  } catch (error) {
    return false;
  }
};

const isNetwork = (network: string): network is NetworkNames => {
  return Object.keys(Networks).includes(network);
};

export { isContractId, isPubKey, isNetwork };
