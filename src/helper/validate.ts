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

    // Asset codes must follow Stellar conventions:
    // 1. Alphanumeric 4 (1-4 characters)
    // 2. Alphanumeric 12 (5-12 characters)
    if (code.length < 1 || code.length > 12) return false;

    // Asset codes can only contain a-z, A-Z, 0-9
    if (!/^[a-zA-Z0-9]+$/.test(code)) return false;

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

// any address that can send or receive a token transfer
const isTransferAddress = (address: string) =>
  StrKey.isValidEd25519PublicKey(address) ||
  StrKey.isValidMed25519PublicKey(address) ||
  StrKey.isValidContract(address) ||
  StrKey.isValidMuxedContract(address);

// A token transfer amount is an integer in the token's smallest unit and is
// parsed into an i128, whose largest value has 39 digits. Bounding the length
// here keeps a client-sized string from reaching the BigInt parse. A JSON
// number is accepted too because the extension sends the amount that way.
const MAX_TRANSFER_AMOUNT_DIGITS = 39;
const isTransferAmount = (amount: unknown) => {
  if (typeof amount === "number") {
    return Number.isInteger(amount) && amount >= 0;
  }
  return (
    typeof amount === "string" &&
    amount.length <= MAX_TRANSFER_AMOUNT_DIGITS &&
    /^[0-9]+$/.test(amount)
  );
};

export {
  isContractId,
  isPubKey,
  isNetwork,
  isTransferAddress,
  isTransferAmount,
  isValidTokenString,
};
