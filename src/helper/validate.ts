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

const isValidTokenString = (asset: string) => {
  try {
    if (asset === "XLM" || asset === "native") return true;
    const [code, issuer] = asset.split(":");
    if (!code || !issuer) return false;

    // Validate the issuer is a valid public key
    if (!isPubKey(issuer)) return false;

    // Asset codes must be 1-12 characters
    if (code.length < 1 || code.length > 12) return false;

    // Asset codes can only contain A-Z, 0-9
    if (!/^[A-Z0-9]+$/.test(code)) return false;

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

export { isContractId, isPubKey, isNetwork, isValidTokenString };
