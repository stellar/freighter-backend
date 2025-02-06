import { Client, CombinedError } from "@urql/core";
import axios from "axios";
import { Logger } from "pino";
import * as StellarSdkNext from "stellar-sdk-next";
import * as StellarSdk from "stellar-sdk";
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
  isSacContract,
} from "../../helper/soroban-rpc";
import {
  transformAccountBalancesCurrentData,
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
  hasSubForPublicKey,
} from "../../helper/mercury";
import { getSdk } from "../../helper/stellar";

const DEFAULT_RETRY_AMOUNT = 5;

export const ERROR_MESSAGES = {
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
  currentDataClientMaker(network: NetworkNames, key: string): Client;
  backends: {
    TESTNET: string;
    PUBLIC: string;
  };
  credentials: {
    [index: string]: {
      email: string;
      password: string;
    };
    TESTNET: {
      email: string;
      password: string;
    };
    PUBLIC: {
      email: string;
      password: string;
    };
  };
}

interface Balances {
  [key: string]: {};
}

export class MercuryClient {
  mercurySession: MercurySession;
  tokens: {
    [index: string]: string;
    TESTNET: string;
    PUBLIC: string;
  };
  redisClient?: Redis;
  logger: Logger;
  mercuryErrorCounter: Prometheus.Counter<"endpoint">;
  rpcErrorCounter: Prometheus.Counter<"rpc">;
  criticalError: Prometheus.Counter<"message">;

  constructor(
    mercurySession: MercurySession,
    logger: Logger,
    register: Prometheus.Registry,
    metrics: {
      mercuryErrorCounter: Prometheus.Counter<"endpoint">;
      rpcErrorCounter: Prometheus.Counter<"rpc">;
      criticalError: Prometheus.Counter<"message">;
    },
    redisClient?: Redis,
  ) {
    this.mercurySession = mercurySession;
    this.logger = logger;
    this.redisClient = redisClient;

    this.mercuryErrorCounter = metrics.mercuryErrorCounter;
    this.rpcErrorCounter = metrics.rpcErrorCounter;
    this.criticalError = metrics.criticalError;

    this.tokens = {
      TESTNET: "",
      PUBLIC: "",
    };

    register.registerMetric(this.mercuryErrorCounter);
    register.registerMetric(this.rpcErrorCounter);
    register.registerMetric(this.criticalError);
  }

  tokenBalanceKey = (pubKey: string, network: NetworkNames) => {
    const Sdk = getSdk(StellarSdk.Networks[network]);
    // { "vec": [{ "symbol": "Balance" }, { "Address": <...pubkey...> }] }
    const addr = new Sdk.Address(pubKey).toScVal();
    return Sdk.xdr.ScVal.scvVec([
      Sdk.xdr.ScVal.scvSymbol("Balance"),
      addr,
    ]).toXDR("base64");
  };

  renewMercuryToken = async (network: NetworkNames) => {
    try {
      if (!hasIndexerSupport(network)) {
        throw new Error(`network not currently supported: ${network}`);
      }
      // we need a second client because the authenticate muation does not ignore the current jwt
      const renewClient = this.mercurySession.renewClientMaker(network);
      const creds = this.mercurySession.credentials[network];
      const { data, error } = await renewClient.mutation(
        mutation.authenticate,
        creds,
      );

      if (error) {
        throw new Error(getGraphQlError(error));
      }
      this.tokens[network] = data.authenticate.jwtToken;

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
    network: NetworkNames,
    retryCount?: number,
  ): Promise<T> => {
    try {
      return await method();
    } catch (error: any) {
      // renew and retry 0n 401, otherwise throw the error back up to the caller
      if (
        error.message?.includes(ERROR_MESSAGES.JWT_EXPIRED) ||
        error.response?.status === 401
      ) {
        await this.renewMercuryToken(network);
        this.logger.info("renewed expired jwt");
        return await method();
      }

      // Retry in non 401 cases
      if (retryCount) {
        return await this.renewAndRetry(method, network, retryCount - 1);
      }

      this.logger.error(error);
      throw new Error(error);
    }
  };

  tokenSubscription = async (
    contractId: string,
    pubKey: string,
    network: NetworkNames,
  ) => {
    const Sdk = getSdk(StellarSdkNext.Networks[network]);
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
      topic1: Sdk.xdr.ScVal.scvSymbol("transfer").toXDR("base64"),
      topic2: Sdk.xdr.ScVal.scvSymbol(pubKey).toXDR("base64"),
    };
    const transferFromSub = {
      contract_id: contractId,
      max_single_size: 200,
      topic1: Sdk.xdr.ScVal.scvSymbol("transfer").toXDR("base64"),
      topic3: Sdk.xdr.ScVal.scvSymbol(pubKey).toXDR("base64"),
    };
    const mintSub = {
      contract_id: contractId,
      max_single_size: 200,
      topic1: Sdk.xdr.ScVal.scvSymbol("mint").toXDR("base64"),
    };

    try {
      if (!this.tokens[network]) {
        await this.renewMercuryToken(network);
      }

      const subscribe = async () => {
        const config = {
          headers: {
            Authorization: `Bearer ${this.tokens[network]}`,
          },
        };

        const eventsURL = `${
          this.mercurySession.backends[network as MercurySupportedNetworks]
        }/event`;
        const { data: transferFromRes } = await axios.post(
          eventsURL,
          transferToSub,
          config,
        );
        const { data: transferToRes } = await axios.post(
          eventsURL,
          transferFromSub,
          config,
        );
        const { data: mintRes } = await axios.post(eventsURL, mintSub, config);

        return {
          transferFromRes,
          transferToRes,
          mintRes,
        };
      };

      const { transferFromRes, transferToRes, mintRes } =
        await this.renewAndRetry(subscribe, network, DEFAULT_RETRY_AMOUNT);

      if (!transferFromRes || !transferToRes || !mintRes) {
        throw new Error(ERROR.TOKEN_SUB_FAILED);
      }

      return {
        data: true,
        error: null,
      };
    } catch (error) {
      this.logger.error(error);
      this.criticalError
        .labels({
          message: `Failed to subscribe token history - ${pubKey} on network - ${network} for contract ${contractId}`,
        })
        .inc();
      return {
        data: null,
        error,
      };
    }
  };

  accountSubscription = async (
    pubKey: string,
    network: NetworkNames,
    epochs: number = 6,
  ) => {
    if (!hasIndexerSupport(network)) {
      return {
        data: null,
        error: `network not currently supported: ${network}`,
      };
    }

    try {
      if (!this.tokens[network]) {
        await this.renewMercuryToken(network);
      }
      const subscribe = async () => {
        const config = {
          headers: {
            Authorization: `Bearer ${this.tokens[network]}`,
          },
          validateStatus: (status: number) => status < 400,
        };

        const { data } = await axios.post(
          `${
            this.mercurySession.backends[network as MercurySupportedNetworks]
          }/account`,
          { publickey: pubKey, hydrate: true, epochs },
          config,
        );
        return data;
      };

      const data = await this.renewAndRetry(
        subscribe,
        network,
        DEFAULT_RETRY_AMOUNT,
      );

      return {
        data,
        error: null,
      };
    } catch (error) {
      this.logger.error(error);
      this.criticalError
        .labels({
          message: `Failed to subscribe account - ${pubKey} on network - ${network}`,
        })
        .inc();
      return {
        data: null,
        error,
      };
    }
  };

  tokenBalanceSubscription = async (
    contractId: string,
    pubKey: string,
    network: NetworkNames,
  ) => {
    if (!hasIndexerSupport(network)) {
      throw new Error(`network not currently supported: ${network}`);
    }
    try {
      const entrySub = {
        contract_id: contractId,
        max_single_size: 300,
        key_xdr: this.tokenBalanceKey(pubKey, network),
        durability: "persistent",
      };

      if (!this.tokens[network]) {
        await this.renewMercuryToken(network);
      }

      const config = {
        headers: {
          Authorization: `Bearer ${this.tokens[network]}`,
        },
        validateStatus: (status: number) => status < 400,
      };

      const getData = async () => {
        const entryUrl = `${
          this.mercurySession.backends[network as MercurySupportedNetworks]
        }/entry`;
        const { data } = await axios.post(entryUrl, entrySub, config);
        return data;
      };
      const data = await this.renewAndRetry(
        getData,
        network,
        DEFAULT_RETRY_AMOUNT,
      );

      if (this.redisClient) {
        await this.tokenDetails(pubKey, contractId, network);
      }

      return {
        data,
        error: null,
      };
    } catch (error) {
      this.logger.error(error);
      this.criticalError
        .labels({
          message: `Failed to subscribe token balance - ${pubKey} on network - ${network} for contract - ${contractId}`,
        })
        .inc();
      return {
        data: null,
        error,
      };
    }
  };

  tokenDetails = async (
    pubKey: string,
    contractId: string,
    network: NetworkNames,
    fetchBalance: boolean = false,
  ): Promise<{
    name: string;
    symbol: string;
    decimals: string;
    balance?: number;
  }> => {
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
        decimalsBuilder,
        network,
      );

      const nameBuilder = await getTxBuilder(pubKey, network, server);
      const name = await getTokenName(contractId, server, nameBuilder, network);

      const symbolsBuilder = await getTxBuilder(pubKey, network, server);
      const symbol = await getTokenSymbol(
        contractId,
        server,
        symbolsBuilder,
        network,
      );

      let balance: number | undefined;
      if (fetchBalance) {
        const balanceBuilder = await getTxBuilder(pubKey, network, server);
        const Sdk = getSdk(StellarSdkNext.Networks[network]);
        const params = [new Sdk.Address(pubKey).toScVal()];
        balance = await getTokenBalance(
          contractId,
          params,
          server,
          balanceBuilder,
          network,
        );
      }

      const tokenDetails = {
        name,
        decimals,
        symbol,
        ...(balance !== undefined && { balance }),
      };

      if (this.redisClient) {
        await this.redisClient.set(compositeKey, JSON.stringify(tokenDetails));
      }

      return tokenDetails;
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

      const Sdk = getSdk(StellarSdkNext.Networks[network]);
      const { Horizon } = Sdk;

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
      const subs = await this.getAccountSubForPubKey(pubKey, network);
      const hasSubs = hasSubForPublicKey(subs, pubKey);
      if (!hasSubs) {
        const { error } = await this.accountSubscription(pubKey, network);
        if (!error) {
          this.logger.info(
            `Subscribed to missing account sub - ${pubKey} - ${network}`,
          );
        }
        throw new Error(ERROR.MISSING_SUB_FOR_PUBKEY);
      }

      if (!this.tokens[network]) {
        await this.renewMercuryToken(network);
      }

      const urqlClient = this.mercurySession.backendClientMaker(
        network,
        this.tokens[network],
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
        data: await transformAccountHistory(data, network),
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
    useMercury: boolean,
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
      network,
    );
    return horizonResponse;
  };

  getTokenBalancesSorobanRPC = async (
    pubKey: string,
    contractIds: string[],
    network: NetworkNames,
  ) => {
    const Sdk = getSdk(StellarSdk.Networks[network]);
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
        const params = [new Sdk.Address(pubKey).toScVal()];
        const balance = await getTokenBalance(
          id,
          params,
          server,
          builder,
          network,
        );
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
      const isSac = isSacContract(
        balance.name,
        balance.id,
        StellarSdk.Networks[network],
      );
      const issuerKey = isSac ? balance.name.split(":")[1] : balance.id;

      balanceMap[`${balance.symbol}:${issuerKey}`] = {
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
    const Sdk = getSdk(StellarSdkNext.Networks[network]);
    const { Horizon } = Sdk;

    const server = new Horizon.Server(networkUrl, {
      allowHttp: !networkUrl.includes("https"),
    });
    const resp = await fetchAccountDetails(pubKey, server);

    for (let i = 0; i < Object.keys(resp.balances).length; i++) {
      const k = Object.keys(resp.balances)[i];
      const v = resp.balances[k];
      if ("liquidity_pool_id" in v) {
        const _v =
          v as any as StellarSdk.Horizon.HorizonApi.BalanceLineLiquidityPool;
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
              reserves: StellarSdk.Horizon.HorizonApi.Reserve[];
            });
        delete (resp.balances[k] as any).liquidity_pool_id;
      }
    }
    return resp;
  };

  getAccountBalancesMercury = async (
    pubKey: string,
    contractIds: string[],
    network: NetworkNames,
  ) => {
    try {
      if (!hasIndexerSupport(network)) {
        throw new Error(`network not currently supported: ${network}`);
      }

      const tokenDetails = {} as {
        [index: string]: Awaited<ReturnType<MercuryClient["tokenDetails"]>>;
      };
      for (const contractId of contractIds) {
        const details = await this.tokenDetails(pubKey, contractId, network);
        tokenDetails[contractId] = details;
      }

      if (!this.tokens[network]) {
        await this.renewMercuryToken(network);
      }

      const getData = async () => {
        const urqlClientCurrentData =
          this.mercurySession.currentDataClientMaker(
            network,
            this.tokens[network],
          );

        const responseCurrentData = await urqlClientCurrentData.query(
          query.getCurrentDataAccountBalances(
            pubKey,
            this.tokenBalanceKey(pubKey, network),
            contractIds,
          ),
          {},
        );

        const errorMessageCurrentData = getGraphQlError(
          responseCurrentData.error,
        );
        if (errorMessageCurrentData) {
          throw new Error(errorMessageCurrentData);
        }

        return responseCurrentData;
      };
      const responseCurrentData = await this.renewAndRetry(getData, network);
      const data = await transformAccountBalancesCurrentData(
        responseCurrentData,
        tokenDetails,
        contractIds,
        StellarSdk.Networks[network],
      );

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
    useMercury: boolean,
  ) => {
    if (hasIndexerSupport(network) && useMercury) {
      const response = await this.getAccountBalancesMercury(
        pubKey,
        contractIds,
        network,
      );

      // if Mercury returns an error, fallback to the RPCs
      if (!response.error && response.data) {
        const { balances, isFunded, subentryCount } = response.data;
        return {
          balances,
          isFunded,
          subentryCount,
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

    let tokenBalances: Balances = {};
    let classicBalances: {
      balances: Balances;
      subentryCount: number;
    } = {
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
        `failed to fetch classic balances from Horizon: ${pubKey}, ${network}`,
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
        network,
      );
    } catch (error) {
      rpcError = error;
      this.logger.error(error);
      this.logger.error(
        `failed to fetch token balances from Soroban RPC: ${pubKey}, ${network}`,
      );
      this.rpcErrorCounter
        .labels({
          rpc: "Soroban",
        })
        .inc();
    }

    const deDupedTokenBalances = { ...tokenBalances };

    Object.keys(tokenBalances).forEach((key) => {
      if (classicBalances.balances[key]) {
        // we have a classic balance for this asset, no need to include the token balance
        delete deDupedTokenBalances[key];
      }
    });

    return {
      balances: {
        ...classicBalances.balances,
        ...deDupedTokenBalances,
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

  getAccountSubForPubKey = async (
    publicKey: string,
    network: NetworkNames,
  ): Promise<{ publickey: string }[]> => {
    if (!hasIndexerSupport(network)) {
      throw new Error(`network not currently supported: ${network}`);
    }

    try {
      if (!this.tokens[network]) {
        await this.renewMercuryToken(network);
      }
      const getData = async () => {
        const urqlClient = this.mercurySession.backendClientMaker(
          network,
          this.tokens[network],
        );
        const response = await urqlClient.query(
          query.getAccountSubForPubKey(publicKey),
          {},
        );

        const errorMessage = getGraphQlError(response.error);
        if (errorMessage) {
          throw new Error(errorMessage);
        }

        return response.data.allFullAccountSubscriptionsList;
      };
      const response = await this.renewAndRetry(getData, network);
      return response;
    } catch (error) {
      this.logger.error(error);
      return [];
    }
  };

  getTokenBalanceSub = async (
    publicKey: string,
    contractId: string,
    network: NetworkNames,
  ) => {
    if (!hasIndexerSupport(network)) {
      throw new Error(`network not currently supported: ${network}`);
    }
    try {
      if (!this.tokens[network]) {
        await this.renewMercuryToken(network);
      }
      const getData = async () => {
        const urqlClient = this.mercurySession.backendClientMaker(
          network,
          this.tokens[network],
        );
        const response = await urqlClient.query(
          query.getTokenBalanceSub(
            contractId,
            this.tokenBalanceKey(publicKey, network),
          ),
          {},
        );

        const errorMessage = getGraphQlError(response.error);
        if (errorMessage) {
          throw new Error(errorMessage);
        }

        return response.data.allEntryUpdates.nodes;
      };
      const response = await this.renewAndRetry(getData, network);
      return response;
    } catch (error) {
      this.logger.error(error);
      return [];
    }
  };

  checkHydrationStatus = async (hydrationId: number, network: NetworkNames) => {
    try {
      if (!this.tokens[network]) {
        await this.renewMercuryToken(network);
      }
      const subscribe = async () => {
        const config = {
          headers: {
            Authorization: `Bearer ${this.tokens[network]}`,
          },
          validateStatus: (status: number) => status < 400,
        };

        const { data } = await axios.get(
          `${
            this.mercurySession.backends[network as MercurySupportedNetworks]
          }/hydrations/${hydrationId}`,
          config,
        );
        return data;
      };

      const data = await this.renewAndRetry(
        subscribe,
        network,
        DEFAULT_RETRY_AMOUNT,
      );
      return data;
    } catch (error) {
      this.logger.error(error);
      return { status: "error", id: hydrationId };
    }
  };
}
