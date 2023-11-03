import { Client } from "@urql/core";
import axios, { AxiosError } from "axios";
import { Logger } from "pino";
import { Address, nativeToScVal, xdr } from "soroban-client";
import { mutation, query } from "./queries";

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
  urqlClient: Client;
  mercurySession: MercurySession;
  eventsURL: string;
  entryURL: string;
  logger: Logger;

  constructor(
    mercurySession: MercurySession,
    urqlClient: Client,
    logger: Logger
  ) {
    this.mercurySession = mercurySession;
    this.eventsURL = `${mercurySession.backend}/event`;
    this.entryURL = `${mercurySession.backend}/entry`;
    this.urqlClient = urqlClient;
    this.logger = logger;
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
      const { data } = await this.urqlClient.query(mutation.authenticate, {
        email: this.mercurySession.email,
        password: this.mercurySession.password,
      });
      this.mercurySession.token = data.authenticate.jwtToken;

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

  renewAndRetry = async <T>(method: () => Promise<T>) => {
    try {
      return await method();
    } catch (error: unknown) {
      let status = 400;
      if (error instanceof AxiosError) {
        status = error.response?.status || 400;
      }

      if (status === 401) {
        this.logger.debug("renewing jwt, and retrying");
        await this.renewMercuryToken();
        return await method();
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
      const config = {
        headers: {
          Authorization: `Bearer ${this.mercurySession.token}`,
        },
      };

      const subscribe = async () => {
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
        const data = await this.urqlClient.query(
          mutation.newAccountSubscription,
          { pubKey, userId: this.mercurySession.userId }
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

  tokenBalanceSubscription = async (contractId: string, pubKey: string) => {
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

  getAccountHistory = async (pubKey: string) => {
    try {
      const getData = async () => {
        const data = await this.urqlClient.query(query.getAccountHistory, {
          publicKeyText: pubKey,
        });
        return data;
      };
      const data = await this.renewAndRetry(getData);

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

  getAccountBalances = async (pubKey: string, contractIds: string[]) => {
    // TODO: once classic subs include balance, add query
    try {
      const getData = async () => {
        const data = await this.urqlClient.query(
          query.getAccountBalances(this.tokenBalanceKey(pubKey), contractIds),
          {}
        );
        return data;
      };
      const data = await this.renewAndRetry(getData);

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
}
