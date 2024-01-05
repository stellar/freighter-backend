import { Client, CombinedError, fetchExchange } from "@urql/core";
import axios from "axios";
import { Logger } from "pino";
import { Address, Horizon, xdr } from "stellar-sdk";
import { Redis } from "ioredis";
import BigNumber from "bignumber.js";
import Prometheus from "prom-client";

import { mutation, query } from "./queries";
import {
  getServer,
  getTokenBalance,
  getTokenDecimals,
  getTokenName,
  getTokenSymbol,
  getTxBuilder,
} from "../../helper/soroban-rpc";
import {
  transformAccountBalances,
  transformAccountHistory,
} from "./helpers/transformers";
import {
  fetchAccountDetails,
  fetchAccountHistory,
} from "../../helper/horizon-rpc";
import { NetworkNames } from "../../helper/validate";

enum NETWORK_URLS {
  PUBLIC = "https://horizon.stellar.org",
  TESTNET = "https://horizon-testnet.stellar.org",
  FUTURENET = "https://horizon-futurenet.stellar.org",
  SANDBOX = "",
  STANDALONE = "",
}

const ERROR_MESSAGES = {
  JWT_EXPIRED: "jwt expired",
};

function getGraphQlError(error?: CombinedError) {
  if (!error) return;
  const [err] = error.graphQLErrors;
  return err.message;
}

const hasIndexerSupport = (network: NetworkNames) => {
  return network === "TESTNET";
};

export interface NewEventSubscriptionPayload {
  contract_id?: string;
  max_single_size: number;
  [key: string]: string | number | undefined;
}

export interface NewEntrySubscriptionPayload {
  contract_id?: string;
  key_xdr?: string;
  max_single_size: number;
}

interface MercurySession {
  backend: string;
  email: string;
  password: string;
  token: string;
  userId: string;
}

export class MercuryClient {
  mercuryUrl: string;
  urqlClient: Client;
  renewClient: Client;
  mercurySession: MercurySession;
  eventsURL: string;
  entryURL: string;
  accountSubUrl: string;
  redisClient?: Redis;
  logger: Logger;
  mercuryErrorCounter: Prometheus.Counter<"endpoint">;
  rpcErrorCounter: Prometheus.Counter<"rpc">;

  constructor(
    mercuryUrl: string,
    mercurySession: MercurySession,
    urqlClient: Client,
    renewClient: Client,
    logger: Logger,
    register: Prometheus.Registry,
    redisClient?: Redis
  ) {
    this.mercuryUrl = mercuryUrl;
    this.mercurySession = mercurySession;
    this.eventsURL = `${mercurySession.backend}/event`;
    this.entryURL = `${mercurySession.backend}/entry`;
    this.accountSubUrl = `${mercurySession.backend}/account`;
    this.urqlClient = urqlClient;
    this.renewClient = renewClient;
    this.logger = logger;
    this.redisClient = redisClient;

    this.mercuryErrorCounter = new Prometheus.Counter({
      name: "freighter_backend_mercury_error_count",
      help: "Count of errors returned from Mercury",
      labelNames: ["endpoint"],
    });

    this.rpcErrorCounter = new Prometheus.Counter({
      name: "freighter_backend_rpc_error_count",
      help: "Count of errors returned from Horizon or Soroban RPCs",
      labelNames: ["rpc"],
    });
    register.registerMetric(this.mercuryErrorCounter);
  }

  tokenBalanceKey = (pubKey: string) => {
    // { "vec": [{ "symbol": "Balance" }, { "Address": <...pubkey...> }] }
    const addr = new Address(pubKey).toScVal();
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("Balance"), addr]).toXDR(
      "base64"
    );
  };

  renewMercuryToken = async () => {
    try {
      const { data, error } = await this.renewClient.mutation(
        mutation.authenticate,
        {
          email: this.mercurySession.email,
          password: this.mercurySession.password,
        }
      );

      if (error) {
        throw new Error(getGraphQlError(error));
      }

      // rebuild client and hold onto new token for subscription rest calls
      const client = new Client({
        url: this.mercuryUrl,
        exchanges: [fetchExchange],
        fetchOptions: () => {
          return {
            headers: { authorization: `Bearer ${data.authenticate.jwtToken}` },
          };
        },
      });
      this.urqlClient = client;
      this.mercurySession.token = data.authenticate.jwtToken;

      return {
        data,
        error: null,
      };
    } catch (error) {
      const _error = JSON.stringify(error);
      this.logger.error(error);
      return {
        data: null,
        error: _error,
      };
    }
  };

  renewAndRetry = async <T>(method: () => Promise<T>) => {
    try {
      return await method();
    } catch (error: unknown) {
      // renew and retry 0n 401, otherwise throw the error back up to the caller
      if (error instanceof Error) {
        if (error.message === ERROR_MESSAGES.JWT_EXPIRED) {
          await this.renewMercuryToken();
          this.logger.info("renewed expired jwt");
          return await method();
        }
        this.logger.error(error.message);
        throw new Error(error.message);
      }

      const _error = JSON.stringify(error);
      this.logger.error(_error);
      throw new Error(_error);
    }
  };

  tokenSubscription = async (
    contractId: string,
    pubKey: string,
    network: NetworkNames
  ) => {
    if (!hasIndexerSupport(network)) {
      return {
        data: null,
        error: `network not currently supported: ${network}`,
      };
    }
    // Token transfer topics are - 1: transfer, 2: from, 3: to, 4: assetName, data(amount)
    const transferToSub = {
      contract_id: contractId,
      max_single_size: 200,
      topic1: xdr.ScVal.scvSymbol("transfer").toXDR("base64"),
      topic2: xdr.ScVal.scvSymbol(pubKey).toXDR("base64"),
    };
    const transferFromSub = {
      contract_id: contractId,
      max_single_size: 200,
      topic1: xdr.ScVal.scvSymbol("transfer").toXDR("base64"),
      topic3: xdr.ScVal.scvSymbol(pubKey).toXDR("base64"),
    };
    const mintSub = {
      contract_id: contractId,
      max_single_size: 200,
      topic1: xdr.ScVal.scvSymbol("mint").toXDR("base64"),
    };

    try {
      const subscribe = async () => {
        const config = {
          headers: {
            Authorization: `Bearer ${this.mercurySession.token}`,
          },
        };

        const { data: transferFromRes } = await axios.post(
          this.eventsURL,
          transferToSub,
          config
        );
        const { data: transferToRes } = await axios.post(
          this.eventsURL,
          transferFromSub,
          config
        );
        const { data: mintRes } = await axios.post(
          this.eventsURL,
          mintSub,
          config
        );

        return {
          transferFromRes,
          transferToRes,
          mintRes,
        };
      };

      const { transferFromRes, transferToRes, mintRes } =
        await this.renewAndRetry(subscribe);

      if (!transferFromRes || !transferToRes || !mintRes) {
        throw new Error("Failed to subscribe to token events");
      }

      return {
        data: true,
        error: null,
      };
    } catch (error) {
      const _error = JSON.stringify(error);
      this.logger.error(_error);
      return {
        data: null,
        error: _error,
      };
    }
  };

  accountSubscription = async (pubKey: string, network: NetworkNames) => {
    if (!hasIndexerSupport(network)) {
      return {
        data: null,
        error: `network not currently supported: ${network}`,
      };
    }

    try {
      const subscribe = async () => {
        const config = {
          headers: {
            Authorization: `Bearer ${this.mercurySession.token}`,
          },
        };
        const { data } = await axios.post(
          this.accountSubUrl,
          { publickey: pubKey, hydrate: true },
          config
        );
        return data;
      };

      const data = await this.renewAndRetry(subscribe);

      return {
        data,
        error: null,
      };
    } catch (error) {
      const _error = JSON.stringify(error);
      this.logger.error(_error);
      return {
        data: null,
        error: _error,
      };
    }
  };

  tokenBalanceSubscription = async (
    contractId: string,
    pubKey: string,
    network: NetworkNames
  ) => {
    try {
      const entrySub = {
        contract_id: contractId,
        max_single_size: 300,
        key_xdr: this.tokenBalanceKey(pubKey),
        durability: "persistent",
      };

      const config = {
        headers: {
          Authorization: `Bearer ${this.mercurySession.token}`,
        },
      };

      const getData = async () => {
        const { data } = await axios.post(this.entryURL, entrySub, config);
        return data;
      };
      const data = await this.renewAndRetry(getData);

      if (this.redisClient) {
        await this.tokenDetails(pubKey, contractId, network);
      }

      return {
        data,
        error: null,
      };
    } catch (error) {
      const _error = JSON.stringify(error);
      this.logger.error(_error);
      return {
        data: null,
        error: _error,
      };
    }
  };

  tokenDetails = async (
    pubKey: string,
    contractId: string,
    network: NetworkNames,
    customRpcUrl?: string
  ): Promise<
    { name: string; symbol: string; decimals: number } | undefined
  > => {
    try {
      const compositeKey = `${network}__${contractId}`;
      // get from cache if we have them, otherwise go to ledger and cache
      if (this.redisClient) {
        const tokenDetails = await this.redisClient.get(compositeKey);
        if (tokenDetails) {
          return JSON.parse(tokenDetails);
        }
      }
      const server = await getServer(network, customRpcUrl);
      // we need a builder per operation, 1 op per tx in Soroban
      const decimalsBuilder = await getTxBuilder(pubKey, network, server);
      const decimals = await getTokenDecimals(
        contractId,
        server,
        decimalsBuilder
      );

      const nameBuilder = await getTxBuilder(pubKey, network, server);
      const name = await getTokenName(contractId, server, nameBuilder);

      const symbolsBuilder = await getTxBuilder(pubKey, network, server);
      const symbol = await getTokenSymbol(contractId, server, symbolsBuilder);
      const tokenDetails = {
        name,
        decimals,
        symbol,
      };

      if (this.redisClient) {
        await this.redisClient.set(compositeKey, JSON.stringify(tokenDetails));
      }

      return {
        name,
        decimals,
        symbol,
      };
    } catch (error) {
      this.logger.error(error);
      return;
    }
  };

  getAccountHistoryHorizon = async (
    pubKey: string,
    network: NetworkNames,
    customHorizonRpcUrl?: string
  ) => {
    try {
      const networkUrl = !NETWORK_URLS[network]
        ? customHorizonRpcUrl
        : NETWORK_URLS[network];
      if (!networkUrl) {
        throw new Error("network not supported");
      }

      const server = new Horizon.Server(networkUrl, {
        allowHttp: !networkUrl.includes("https"),
      });
      const data = await fetchAccountHistory(pubKey, server);
      return {
        data,
        error: null,
      };
    } catch (error) {
      this.logger.error(error);
      const _error = JSON.stringify(error);
      this.rpcErrorCounter
        .labels({
          rpc: "Horizon",
        })
        .inc();
      return {
        data: null,
        error: _error,
      };
    }
  };

  getAccountHistoryMercury = async (pubKey: string) => {
    try {
      const xdrPubKey = new Address(pubKey).toScVal().toXDR("base64");
      const getData = async () => {
        const data = await this.urqlClient.query(query.getAccountHistory, {
          pubKey,
          xdrPubKey,
        });
        const errorMessage = getGraphQlError(data.error);
        if (errorMessage) {
          throw new Error(errorMessage);
        }

        return data;
      };
      const data = await this.renewAndRetry(getData);
      return {
        data: await transformAccountHistory(data),
        error: null,
      };
    } catch (error) {
      const _error = JSON.stringify(error);
      this.logger.error(error);
      return {
        data: null,
        error: _error,
      };
    }
  };

  getAccountHistory = async (
    pubKey: string,
    network: NetworkNames,
    rpcUrls: { horizon?: string; soroban?: string },
    useMercury: boolean
  ) => {
    if (hasIndexerSupport(network) && useMercury) {
      const response = await this.getAccountHistoryMercury(pubKey);

      if (!response.error) {
        return response;
      } else {
        this.logger.error(response.error);
        this.mercuryErrorCounter
          .labels({
            endpoint: "getAccountHistory",
          })
          .inc();
      }
    }

    const horizonResponse = await this.getAccountHistoryHorizon(
      pubKey,
      network,
      rpcUrls.horizon
    );
    return horizonResponse;
  };

  getTokenBalancesSorobanRPC = async (
    pubKey: string,
    contractIds: string[],
    network: NetworkNames,
    customSorobanRpcUrl?: string
  ) => {
    const server = await getServer(network, customSorobanRpcUrl);
    const balances = [];
    for (const id of contractIds) {
      const builder = await getTxBuilder(pubKey, network, server);
      const params = [new Address(pubKey).toScVal()];
      const balance = await getTokenBalance(id, params, server, builder);
      const tokenDetails = await this.tokenDetails(pubKey, id, network);
      balances.push({
        id,
        balance,
        ...tokenDetails,
      });
    }
    const balanceMap = {} as Record<string, any>;
    for (const balance of balances) {
      balanceMap[`${balance.symbol}:${balance.id}`] = {
        token: {
          code: balance.symbol,
          issuer: {
            key: balance.id,
          },
        },
        decimals: balance.decimals,
        total: new BigNumber(balance.balance),
        available: new BigNumber(balance.balance),
      };
    }
    return balanceMap;
  };

  getAccountBalancesHorizon = async (
    pubKey: string,
    network: NetworkNames,
    customHorizonRpcUrl?: string
  ) => {
    const networkUrl = !NETWORK_URLS[network]
      ? customHorizonRpcUrl
      : NETWORK_URLS[network];
    if (!networkUrl) {
      throw new Error("network not supported");
    }

    let balances: any = null;
    let isFunded = null;
    let subentryCount = 0;

    try {
      const server = new Horizon.Server(networkUrl, {
        allowHttp: !networkUrl.includes("https"),
      });
      const resp = await fetchAccountDetails(pubKey, server);
      balances = resp.balances;
      subentryCount = resp.subentryCount;

      for (let i = 0; i < Object.keys(resp.balances).length; i++) {
        const k = Object.keys(resp.balances)[i];
        const v: any = resp.balances[k];
        if (v.liquidity_pool_id) {
          const lp = await server
            .liquidityPools()
            .liquidityPoolId(v.liquidity_pool_id)
            .call();
          balances[k] = {
            ...balances[k],
            liquidityPoolId: v.liquidity_pool_id,
            reserves: lp.reserves,
          };
          delete balances[k].liquidity_pool_id;
        }
      }
      isFunded = true;
    } catch (error) {
      this.logger.error(error);
      return {
        balances,
        isFunded: false,
        subentryCount,
      };
    }
    return {
      balances,
      isFunded,
      subentryCount,
    };
  };

  getAccountBalancesMercury = async (
    pubKey: string,
    contractIds: string[],
    network: NetworkNames
  ) => {
    try {
      const getData = async () => {
        const response = await this.urqlClient.query(
          query.getAccountBalances(
            pubKey,
            this.tokenBalanceKey(pubKey),
            contractIds
          ),
          {}
        );
        const errorMessage = getGraphQlError(response.error);
        if (errorMessage) {
          throw new Error(errorMessage);
        }

        return response;
      };
      const response = await this.renewAndRetry(getData);
      const tokenDetails = {} as { [index: string]: any };
      for (const contractId of contractIds) {
        const details = await this.tokenDetails(pubKey, contractId, network);
        tokenDetails[contractId] = details;
      }
      const data = await transformAccountBalances(response, tokenDetails);

      return {
        data,
        error: null,
      };
    } catch (error) {
      // this.logger.error(error);
      const _error = JSON.stringify(error);
      return {
        data: null,
        error: _error,
      };
    }
  };

  getAccountBalances = async (
    pubKey: string,
    contractIds: string[],
    network: NetworkNames,
    rpcUrls: { horizon?: string; soroban?: string },
    useMercury: boolean
  ) => {
    if (hasIndexerSupport(network) && useMercury) {
      const response = await this.getAccountBalancesMercury(
        pubKey,
        contractIds,
        network
      );

      // if Mercury returns an error, fallback to the RPCs
      if (!response.error) {
        return response;
      } else {
        this.logger.error(response.error);
        this.mercuryErrorCounter
          .labels({
            endpoint: "getAccountBalance",
          })
          .inc();
      }
    }

    let tokenBalances = {};
    let classicBalances = {
      balances: [],
      isFunded: false,
      subentryCount: 0,
    };
    try {
      classicBalances = await this.getAccountBalancesHorizon(
        pubKey,
        network,
        rpcUrls.horizon
      );
    } catch (error) {
      this.logger.error(error);
      this.logger.error(
        `failed to fetch token classic balances from Horizon: ${pubKey}, ${network}`
      );
      this.rpcErrorCounter
        .labels({
          rpc: "Horizon",
        })
        .inc();
      return {
        data: null,
        error,
      };
    }

    try {
      tokenBalances = await this.getTokenBalancesSorobanRPC(
        pubKey,
        contractIds,
        network,
        rpcUrls.soroban
      );
    } catch (error) {
      this.logger.error(error);
      this.logger.error(
        `failed to fetch token token balances from Soroban RPC: ${pubKey}, ${network}`
      );
      this.rpcErrorCounter
        .labels({
          rpc: "Soroban",
        })
        .inc();
      return {
        data: null,
        error,
      };
    }

    const data = {
      balances: {
        ...classicBalances.balances,
        ...tokenBalances,
      },
      isFunded: classicBalances.isFunded,
      subentryCount: classicBalances.subentryCount,
    };
    return {
      data,
      error: null,
    };
  };
}
