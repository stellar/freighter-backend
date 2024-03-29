import { NetworkNames } from "./validate";

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
