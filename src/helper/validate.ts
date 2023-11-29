import { StrKey } from "stellar-sdk";

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

export { isContractId, isPubKey };
