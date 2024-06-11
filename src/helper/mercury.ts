import { NetworkNames } from "./validate";

export const REDIS_USE_MERCURY_KEY = "USE_MERCURY";

export const hasIndexerSupport = (network: NetworkNames) => {
  return network === "TESTNET" || network === "PUBLIC";
};

export enum MercurySupportedNetworks {
  TESTNET = "TESTNET",
  PUBLIC = "PUBLIC",
}

export const hasSubForPublicKey = (
  subs: { publickey: string }[],
  publicKey: string
) => subs.some((sub: { publickey: string }) => sub.publickey === publicKey);

export const hasSubForTokenBalance = (
  subs: { contractId: string }[],
  contractId: string
) => subs.some((sub: { contractId: string }) => sub.contractId === contractId);
