import { Client, CombinedError } from "@urql/core";
import axios from "axios";
import { Logger } from "pino";
import { Address, Horizon, xdr } from "stellar-sdk";
import { Redis } from "ioredis";
import BigNumber from "bignumber.js";
import Prometheus from "prom-client";

import { mutation, query } from "./queries";
import {
  SOROBAN_RPC_URLS,
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
  AssetBalance,
  fetchAccountDetails,
  fetchAccountHistory,
  NativeBalance,
  NETWORK_URLS,
} from "../../helper/horizon-rpc";
import { NetworkNames } from "../../helper/validate";
import { ERROR } from "../../helper/error";
import {
  MercurySupportedNetworks,
  hasIndexerSupport,
} from "../../helper/mercury";

const ERROR_MESSAGES = {
  JWT_EXPIRED: "1_kJdMBB7ytvgRIqF1clh2iz2iI",
};

function getGraphQlError(error?: CombinedError) {
  if (!error) return;
  const [err] = error.graphQLErrors;

  if (err) {
    return err.message;
  }

  if (error.networkError) {
    return error.networkError.message;
  }

  return JSON.stringify(error);
}

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
  renewClientMaker(network: NetworkNames): Client;
  backendClientMaker(network: NetworkNames, key: string): Client;
  backends: {
    TESTNET: string;
    PUBLIC: string;
  };
  email: string;
  password: string;
  token: string;
  userId: string;
}

export class MercuryClient {
  mercurySession: MercurySession;
  redisClient?: Redis;
  logger: Logger;
  mercuryErrorCounter: Prometheus.Counter<"endpoint">;
  rpcErrorCounter: Prometheus.Counter<"rpc">;

  constructor(
    mercurySession: MercurySession,
    logger: Logger,
    register: Prometheus.Registry,
    redisClient?: Redis
  ) {
    this.mercurySession = mercurySession;
    this.logger = logger;
    this.redisClient = redisClient;

    this.mercuryErrorCounter = new Prometheus.Counter({
      name: "freighter_backend_mercury_error_count",
      help: "Count of errors returned from Mercury",
      labelNames: ["endpoint"],
      registers: [register],
    });

    this.rpcErrorCounter = new Prometheus.Counter({
      name: "freighter_backend_rpc_error_count",
      help: "Count of errors returned from Horizon or Soroban RPCs",
      labelNames: ["rpc"],
      registers: [register],
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

  renewMercuryToken = async (network: NetworkNames) => {
    try {
      if (!hasIndexerSupport(network)) {
        throw new Error(`network not currently supported: ${network}`);
      }
      // we need a second client because the authenticate muation does not ignore the current jwt
      const renewClient = this.mercurySession.renewClientMaker(network);
      const { data, error } = await renewClient.mutation(
        mutation.authenticate,
        {
          email: this.mercurySession.email,
          password: this.mercurySession.password,
        }
      );

      if (error) {
        throw new Error(getGraphQlError(error));
      }

      this.mercurySession.token = data.authenticate.jwtToken;

      return {
        data,
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error,
      };
    }
  };

  renewAndRetry = async <T>(
    method: () => Promise<T>,
    network: NetworkNames
  ) => {
    try {
      return await method();
    } catch (error: any) {
      // renew and retry 0n 401, otherwise throw the error back up to the caller
      if (error instanceof Error) {
        if (error.message.includes(ERROR_MESSAGES.JWT_EXPIRED)) {
          await this.renewMercuryToken(network);
          this.logger.info("renewed expired jwt");
          return await method();
        }

        this.logger.error(error.message);
        throw new Error(error.message);
      }

      // In the case of subscription posts or non graphQL queries, the 401 response is different
      if (error.response?.status === 401) {
        await this.renewMercuryToken(network);
        this.logger.info("renewed expired jwt");
        return await method();
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

        const eventsURL = `${
          this.mercurySession.backends[network as MercurySupportedNetworks]
        }/event`;
        const { data: transferFromRes } = await axios.post(
          eventsURL,
          transferToSub,
          config
        );
        const { data: transferToRes } = await axios.post(
          eventsURL,
          transferFromSub,
          config
        );
        const { data: mintRes } = await axios.post(eventsURL, mintSub, config);

        return {
          transferFromRes,
          transferToRes,
          mintRes,
        };
      };

      const { transferFromRes, transferToRes, mintRes } =
        await this.renewAndRetry(subscribe, network);

      if (!transferFromRes || !transferToRes || !mintRes) {
        throw new Error(ERROR.TOKEN_SUB_FAILED);
      }

      return {
        data: true,
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error,
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
          `${
            this.mercurySession.backends[network as MercurySupportedNetworks]
          }/account`,
          { publickey: pubKey, hydrate: true },
          config
        );
        return data;
      };

      const data = await this.renewAndRetry(subscribe, network);

      return {
        data,
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error,
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
        const entryUrl = `${
          this.mercurySession.backends[network as MercurySupportedNetworks]
        }/entry`;
        const { data } = await axios.post(entryUrl, entrySub, config);
        return data;
      };
      const data = await this.renewAndRetry(getData, network);

      if (this.redisClient) {
        await this.tokenDetails(pubKey, contractId, network);
      }

      return {
        data,
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error,
      };
    }
  };

  tokenDetails = async (
    pubKey: string,
    contractId: string,
    network: NetworkNames
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
      const server = await getServer(network);
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
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(JSON.stringify(error));
    }
  };

  getAccountHistoryHorizon = async (pubKey: string, network: NetworkNames) => {
    try {
      const networkUrl = NETWORK_URLS[network];
      if (!networkUrl) {
        throw new Error(ERROR.UNSUPPORTED_NETWORK);
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
      const _error = JSON.stringify(error);
      if (error && typeof error === "object" && "message" in error) {
        const err = JSON.parse(error.message as string);
        // Not found errors are normal for unfunded accounts, dont alert
        if (err.name !== "NotFoundError") {
          this.rpcErrorCounter
            .labels({
              rpc: "Horizon",
            })
            .inc();
        }
      }

      return {
        data: null,
        error: _error,
      };
    }
  };

  getAccountHistoryMercury = async (pubKey: string, network: NetworkNames) => {
    try {
      if (!hasIndexerSupport(network)) {
        throw new Error(`network not currently supported: ${network}`);
      }
      const urqlClient = this.mercurySession.backendClientMaker(
        network,
        this.mercurySession.token
      );
      const getData = async () => {
        const data = await urqlClient.query(query.getAccountHistory, {
          pubKey,
        });

        const errorMessage = getGraphQlError(data.error);
        if (errorMessage) {
          throw new Error(errorMessage);
        }

        return data;
      };
      const data = await this.renewAndRetry(getData, network);
      return {
        data: await transformAccountHistory(data),
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error,
      };
    }
  };

  getAccountHistory = async (
    pubKey: string,
    network: NetworkNames,
    useMercury: boolean
  ) => {
    if (hasIndexerSupport(network) && useMercury) {
      const response = await this.getAccountHistoryMercury(pubKey, network);

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
      network
    );
    return horizonResponse;
  };

  getTokenBalancesSorobanRPC = async (
    pubKey: string,
    contractIds: string[],
    network: NetworkNames
  ) => {
    const networkUrl = SOROBAN_RPC_URLS[network];
    if (!networkUrl) {
      throw new Error(ERROR.UNSUPPORTED_NETWORK);
    }

    const balances = [];
    const balanceMap = {} as Record<string, any>;

    const server = await getServer(network);
    for (const id of contractIds) {
      try {
        const builder = await getTxBuilder(pubKey, network, server);
        const params = [new Address(pubKey).toScVal()];
        const balance = await getTokenBalance(id, params, server, builder);
        const tokenDetails = await this.tokenDetails(pubKey, id, network);
        balances.push({
          id,
          balance,
          ...tokenDetails,
        });
      } catch (error) {
        this.logger.error(error);
        continue;
      }
    }

    for (const balance of balances) {
      balanceMap[`${balance.symbol}:${balance.id}`] = {
        token: {
          code: balance.symbol,
          issuer: {
            key: balance.id,
          },
        },
        contractId: balance.id,
        symbol: balance.symbol,
        decimals: balance.decimals,
        total: new BigNumber(balance.balance),
        available: new BigNumber(balance.balance),
      };
    }
    return balanceMap;
  };

  getAccountBalancesHorizon = async (pubKey: string, network: NetworkNames) => {
    const networkUrl = NETWORK_URLS[network];
    if (!networkUrl) {
      throw new Error(ERROR.UNSUPPORTED_NETWORK);
    }

    const server = new Horizon.Server(networkUrl, {
      allowHttp: !networkUrl.includes("https"),
    });
    const resp = await fetchAccountDetails(pubKey, server);

    for (let i = 0; i < Object.keys(resp.balances).length; i++) {
      const k = Object.keys(resp.balances)[i];
      const v = resp.balances[k];
      if ("liquidity_pool_id" in v) {
        const _v = v as any as Horizon.HorizonApi.BalanceLineLiquidityPool;
        const lp = await server
          .liquidityPools()
          .liquidityPoolId(_v.liquidity_pool_id)
          .call();
        resp.balances[k] = {
          ...resp.balances[k],
          liquidityPoolId: _v.liquidity_pool_id,
          reserves: lp.reserves,
        } as
          | AssetBalance
          | (NativeBalance & {
              liquidityPoolId: string;
              reserves: Horizon.HorizonApi.Reserve[];
            });
        delete (resp.balances[k] as any).liquidity_pool_id;
      }
    }
    return resp;
  };

  getAccountBalancesMercury = async (
    pubKey: string,
    contractIds: string[],
    network: NetworkNames
  ) => {
    try {
      if (!hasIndexerSupport(network)) {
        throw new Error(`network not currently supported: ${network}`);
      }
      const urqlClient = this.mercurySession.backendClientMaker(
        network,
        this.mercurySession.token
      );
      const getData = async () => {
        const response = await urqlClient.query(
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
      const response = await this.renewAndRetry(getData, network);
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
      return {
        data: null,
        error,
      };
    }
  };

  getAccountBalances = async (
    pubKey: string,
    contractIds: string[],
    network: NetworkNames,
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
        return {
          data: response.data,
          error: {
            horizon: null,
            soroban: null,
          },
        };
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
      balances: {},
      subentryCount: 0,
    };
    let horizonError = null;
    let rpcError = null;
    try {
      classicBalances = await this.getAccountBalancesHorizon(pubKey, network);
    } catch (error) {
      this.logger.error(error);
      this.logger.error(
        `failed to fetch classic balances from Horizon: ${pubKey}, ${network}`
      );
      if (error && typeof error === "object" && "message" in error) {
        const err = JSON.parse(error.message as string);
        // Not found errors are normal for unfunded accounts, dont alert
        if (err.name !== "NotFoundError") {
          horizonError = err;
          this.rpcErrorCounter
            .labels({
              rpc: "Horizon",
            })
            .inc();
        }
      }
    }

    try {
      tokenBalances = await this.getTokenBalancesSorobanRPC(
        pubKey,
        contractIds,
        network
      );
    } catch (error) {
      rpcError = error;
      this.logger.error(error);
      this.logger.error(
        `failed to fetch token balances from Soroban RPC: ${pubKey}, ${network}`
      );
      this.rpcErrorCounter
        .labels({
          rpc: "Soroban",
        })
        .inc();
    }

    return {
      balances: {
        ...classicBalances.balances,
        ...tokenBalances,
      },
      // Horizon 400s when an account is unfunded, so if we have anything in balances we are funded
      isFunded: horizonError
        ? null
        : Boolean(Object.keys(classicBalances.balances).length),
      subentryCount: horizonError ? null : classicBalances.subentryCount,
      error: {
        horizon: horizonError,
        soroban: rpcError,
      },
    };
  };
}
