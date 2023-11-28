import { Client, CombinedError, fetchExchange } from "@urql/core";
import axios from "axios";
import { Logger } from "pino";
import { Address, Networks, nativeToScVal, xdr } from "soroban-client";
import { Redis } from "ioredis";
import { Server } from "stellar-sdk";

import { mutation, query } from "./queries";
import {
  getServer,
  getTokenBalance,
  getTokenDecimals,
  getTokenName,
  getTokenSymbol,
  getTxBuilder,
} from "../../helper/soroban-rpc";
import { transformAccountBalances } from "./helpers/transformers";
import BigNumber from "bignumber.js";
import { fetchAccountDetails } from "../../helper/horizon-rpc";

type NetworkNames = keyof typeof Networks;

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

  constructor(
    mercuryUrl: string,
    mercurySession: MercurySession,
    urqlClient: Client,
    renewClient: Client,
    logger: Logger,
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

  tokenSubscription = async (contractId: string, pubKey: string) => {
    // Token transfer topics are - 1: transfer, 2: from, 3: to, 4: assetName, data(amount)
    const transferToSub = {
      contract_id: contractId,
      max_single_size: 200,
      topic1: nativeToScVal("transfer").toXDR("base64"),
      topic2: nativeToScVal(pubKey).toXDR("base64"),
    };
    const transferFromSub = {
      contract_id: contractId,
      max_single_size: 200,
      topic1: nativeToScVal("transfer").toXDR("base64"),
      topic3: nativeToScVal(pubKey).toXDR("base64"),
    };
    const mintSub = {
      contract_id: contractId,
      max_single_size: 200,
      topic1: nativeToScVal("mint").toXDR("base64"),
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

  accountSubscription = async (pubKey: string) => {
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
        max_single_size: 150,
        key_xdr: this.tokenBalanceKey(pubKey),
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
      this.logger.error(error);
      return;
    }
  };

  getAccountHistory = async (pubKey: string) => {
    try {
      const getData = async () => {
        const data = await this.urqlClient.query(query.getAccountHistory, {
          pubKey,
        });
        const errorMessage = getGraphQlError(data.error);
        if (errorMessage) {
          throw new Error(errorMessage);
        }

        return data;
      };
      const data = await this.renewAndRetry(getData);

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

  getTokenBalancesSorobanRPC = async (
    pubKey: string,
    contractIds: string[],
    network: NetworkNames
  ) => {
    const server = await getServer(network);
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
    return balances;
  };

  getAccountBalancesHorizon = async (pubKey: string, network: NetworkNames) => {
    const networkUrl = NETWORK_URLS[network];

    let balances: any = null;
    let isFunded = null;
    let subentryCount = 0;

    try {
      const server = new Server(networkUrl, {
        allowHttp: !networkUrl.includes("https"),
      });
      const resp = await fetchAccountDetails(pubKey, server);

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
      console.error(error);
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
    if (contractIds.length < 1) {
      return {
        data: [],
        error: null,
      };
    }
    // TODO: once classic subs include balance, add query
    try {
      const getData = async () => {
        const response = await this.urqlClient.query(
          query.getAccountBalances(this.tokenBalanceKey(pubKey), contractIds),
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
      console.log(error);
      const _error = JSON.stringify(error);
      this.logger.error(_error);
      return {
        data: null,
        error: _error,
      };
    }
  };

  getAccountBalances = async (
    pubKey: string,
    contractIds: string[],
    network: NetworkNames
  ) => {
    if (hasIndexerSupport(network)) {
      const data = await this.getAccountBalancesMercury(
        pubKey,
        contractIds,
        network
      );
      // const mockResponse = {
      //   balances: {
      //     native: {
      //       token: { type: "native", code: "XLM" },
      //       total: new BigNumber(4),
      //       available: new BigNumber(1),
      //     },
      //     ["DT:CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP"]: {
      //       token: {
      //         code: "DT",
      //         issuer: {
      //           key: "CCWAMYJME4H5CKG7OLXGC2T4M6FL52XCZ3OQOAV6LL3GLA4RO4WH3ASP",
      //         },
      //       },
      //       decimals: 7,
      //       total: new BigNumber("10"),
      //       available: new BigNumber("10"),
      //     },
      //     ["USDC:GCK3D3V2XNLLKRFGFFFDEJXA4O2J4X36HET2FE446AV3M4U7DPHO3PEM"]: {
      //       token: {
      //         code: "USDC",
      //         issuer: {
      //           key: "GCK3D3V2XNLLKRFGFFFDEJXA4O2J4X36HET2FE446AV3M4U7DPHO3PEM",
      //         },
      //       },
      //       total: new BigNumber("100"),
      //       available: new BigNumber("100"),
      //     },
      //   },
      //   isFunded: true,
      //   subentryCount: 1
      // }

      return {
        data,
        error: null,
      };
    } else {
      const classicBalances = await this.getAccountBalancesHorizon(
        pubKey,
        network
      );
      const tokenBalances = await this.getTokenBalancesSorobanRPC(
        pubKey,
        contractIds,
        network
      );

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
    }
  };
}
