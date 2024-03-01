import { NetworkNames } from "./validate";

export const hasIndexerSupport = (network: NetworkNames) => {
  return network === "TESTNET" || network === "PUBLIC";
};

export enum MercurySupportedNetworks {
  TESTNET = "TESTNET",
  PUBLIC = "PUBLIC",
}
