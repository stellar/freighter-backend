import { Redis } from "ioredis";
import { Client, fetchExchange } from "@urql/core";

import { NetworkNames } from "./validate";
import { mode } from "./env";
import { fetchWithTimeout } from "./fetch";

interface EndpointsMap {
  TESTNET: string;
  PUBLIC: string;
}

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

export const getUseMercury = async (
  mode: mode,
  useMercuryConf: boolean,
  redis?: Redis
) => {
  if (mode === "development" || !redis) {
    return useMercuryConf;
  }
  const redisValue = await redis.get(REDIS_USE_MERCURY_KEY);
  return redisValue === "true";
};

export const buildRenewClientMaker =
  (endpoints: EndpointsMap) => (network: NetworkNames) => {
    if (!hasIndexerSupport(network)) {
      throw new Error(`network not currently supported: ${network}`);
    }

    return new Client({
      url: endpoints[network as MercurySupportedNetworks],
      exchanges: [fetchExchange],
      fetch: fetchWithTimeout,
    });
  };

export const buildBackendClientMaker =
  (endpoints: EndpointsMap) => (network: NetworkNames, key: string) => {
    if (!hasIndexerSupport(network)) {
      throw new Error(`network not currently supported: ${network}`);
    }

    return new Client({
      url: `${endpoints[network as MercurySupportedNetworks]}`,
      exchanges: [fetchExchange],
      fetch: fetchWithTimeout,
      fetchOptions: () => {
        return {
          headers: { authorization: `Bearer ${key}` },
        };
      },
    });
  };

export const buildCurrentDataClientMaker =
  (endpoints: EndpointsMap) => (network: NetworkNames, key: string) => {
    if (!hasIndexerSupport(network)) {
      throw new Error(`network not currently supported: ${network}`);
    }

    return new Client({
      url: `${endpoints[network as MercurySupportedNetworks]}`,
      exchanges: [fetchExchange],
      fetch: fetchWithTimeout,
      fetchOptions: () => {
        return {
          headers: { authorization: `Bearer ${key}` },
        };
      },
    });
  };
