import Fastify, { FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import rateLimiter from "@fastify/rate-limit";
import cors from "@fastify/cors";
import { Logger } from "pino";
import { Redis } from "ioredis";

import { MercuryClient } from "../service/mercury";
import { ajv } from "./validators";
import {
  isContractId,
  isPubKey,
  isNetwork,
  NetworkNames,
} from "../helper/validate";
import { submitTransaction } from "../helper/horizon-rpc";
import {
  BASE_FEE,
  Memo,
  MemoType,
  Operation,
  SorobanRpc,
  Transaction,
  TransactionBuilder,
  xdr,
} from "stellar-sdk";
import { buildTransfer, simulateTx } from "../helper/soroban-rpc";

const API_VERSION = "v1";

export async function initApiServer(
  mercuryClient: MercuryClient,
  logger: Logger,
  useMercury: boolean,
  redis?: Redis
) {
  const server = Fastify({
    logger,
  });
  server.setValidatorCompiler(({ schema }) => {
    return ajv.compile(schema);
  });
  server.register(rateLimiter, {
    max: 100,
    timeWindow: "1 minute",
    redis,
  });

  server.register(helmet, { global: true });
  await server.register(cors, {
    origin: "*",
  });
  server.register(
    (instance, _opts, next) => {
      instance.route({
        method: "GET",
        url: "/ping",
        handler: async (_request, reply) => {
          reply.code(200).send("Alive!");
        },
      });

      instance.route({
        method: "GET",
        url: "/account-history/:pubKey",
        schema: {
          params: {
            ["pubKey"]: {
              type: "string",
              validator: (qStr: string) => isPubKey(qStr),
            },
          },
          querystring: {
            ["network"]: {
              type: "string",
              validator: (qStr: string) => isNetwork(qStr),
            },
            ["horizon_url"]: {
              type: "string",
            },
            ["soroban_url"]: {
              type: "string",
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Params: { ["pubKey"]: string };
            Querystring: {
              ["network"]: NetworkNames;
              ["horizon_url"]?: string;
              ["soroban_url"]?: string;
            };
          }>,
          reply
        ) => {
          const pubKey = request.params["pubKey"];
          const { network, horizon_url, soroban_url } = request.query;
          const { data, error } = await mercuryClient.getAccountHistory(
            pubKey,
            network,
            { horizon: horizon_url, soroban: soroban_url },
            useMercury
          );
          if (error) {
            reply.code(400).send(JSON.stringify(error));
          } else {
            reply.code(200).send(data);
          }
        },
      });

      instance.route({
        method: "GET",
        url: "/account-balances/:pubKey",
        schema: {
          params: {
            ["pubKey"]: {
              type: "string",
              validator: (qStr: string) => isPubKey(qStr),
            },
          },
          querystring: {
            ["contract_ids"]: {
              type: "string",
              validator: (qStr: string) => qStr.split(",").every(isContractId),
            },
            ["network"]: {
              type: "string",
              validator: (qStr: string) => isNetwork(qStr),
            },
            ["horizon_url"]: {
              type: "string",
            },
            ["soroban_url"]: {
              type: "string",
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Params: { ["pubKey"]: string };
            Querystring: {
              ["contract_ids"]: string;
              ["network"]: NetworkNames;
              ["horizon_url"]?: string;
              ["soroban_url"]?: string;
            };
          }>,
          reply
        ) => {
          const pubKey = request.params["pubKey"];
          const { network, horizon_url, soroban_url } = request.query;
          const contractIds = request.query["contract_ids"]
            ? request.query["contract_ids"].split(",")
            : [];
          const { data, error } = await mercuryClient.getAccountBalances(
            pubKey,
            contractIds,
            network,
            { horizon: horizon_url, soroban: soroban_url },
            useMercury
          );
          if (error) {
            reply.code(400).send(JSON.stringify(error));
          } else {
            reply.code(200).send(data);
          }
        },
      });

      instance.route({
        method: "GET",
        url: "/token-details/:contractId",
        schema: {
          params: {
            ["contractId"]: {
              type: "string",
              validator: (qStr: string) => isContractId(qStr),
            },
          },
          querystring: {
            ["pub_key"]: {
              type: "string",
              validator: (qStr: string) => isPubKey(qStr),
            },
            ["network"]: {
              type: "string",
              validator: (qStr: string) => isNetwork(qStr),
            },
            ["soroban_url"]: {
              type: "string",
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Params: { ["contractId"]: string };
            Querystring: {
              ["contract_ids"]: string;
              ["pub_key"]: string;
              ["network"]: NetworkNames;
              ["soroban_url"]?: string;
            };
          }>,
          reply
        ) => {
          const contractId = request.params["contractId"];
          const { network, pub_key, soroban_url } = request.query;

          if (!useMercury) {
            reply.code(400).send(JSON.stringify("Mercury disabled"));
          }

          try {
            const data = await mercuryClient.tokenDetails(
              pub_key,
              contractId,
              network,
              soroban_url
            );
            reply.code(200).send(data);
          } catch (error) {
            reply.code(400).send(JSON.stringify(error));
          }
        },
      });

      instance.route({
        method: "POST",
        url: "/subscription/token",
        schema: {
          body: {
            type: "object",
            properties: {
              contract_id: { type: "string" },
              pub_key: { type: "string" },
              network: { type: "string" },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                data: { type: "object" },
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Body: {
              contract_id: string;
              pub_key: string;
              network: NetworkNames;
            };
          }>,
          reply
        ) => {
          const { contract_id, pub_key, network } = request.body;

          if (!useMercury) {
            reply.code(400).send(JSON.stringify("Mercury disabled"));
          }

          const { data, error } = await mercuryClient.tokenSubscription(
            contract_id,
            pub_key,
            network
          );
          if (error) {
            reply.code(400).send(JSON.stringify(error));
          } else {
            reply.code(200).send(data);
          }
        },
      });

      instance.route({
        method: "POST",
        url: "/subscription/account",
        schema: {
          body: {
            type: "object",
            properties: {
              pub_key: { type: "string" },
              network: { type: "string" },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                data: { type: "object" },
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Body: { pub_key: string; network: NetworkNames };
          }>,
          reply
        ) => {
          const { pub_key, network } = request.body;

          if (!useMercury) {
            reply.code(400).send(JSON.stringify("Mercury disabled"));
          }

          const { data, error } = await mercuryClient.accountSubscription(
            pub_key,
            network
          );
          if (error) {
            reply.code(400).send(JSON.stringify(error));
          } else {
            reply.code(200).send(data);
          }
        },
      });

      instance.route({
        method: "POST",
        url: "/subscription/token-balance",
        schema: {
          body: {
            type: "object",
            properties: {
              contract_id: { type: "string" },
              pub_key: { type: "string" },
              network: { type: "string" },
            },
          },
          response: {
            200: {
              type: "object",
              properties: {
                data: { type: "object" },
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Body: {
              pub_key: string;
              contract_id: string;
              network: NetworkNames;
            };
          }>,
          reply
        ) => {
          const { pub_key, contract_id, network } = request.body;

          if (!useMercury) {
            reply.code(400).send(JSON.stringify("Mercury disabled"));
          }

          const { data, error } = await mercuryClient.tokenBalanceSubscription(
            contract_id,
            pub_key,
            network
          );
          if (error) {
            reply.code(400).send(JSON.stringify(error));
          } else {
            reply.code(200).send(data);
          }
        },
      });

      instance.route({
        method: "POST",
        url: "/submit-tx",
        schema: {
          body: {
            type: "object",
            properties: {
              signed_xdr: { type: "string" },
              network_url: { type: "string" },
              network_passphrase: { type: "string" },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Body: {
              signed_xdr: string;
              network_url: string;
              network_passphrase: string;
            };
          }>,
          reply
        ) => {
          const { signed_xdr, network_url, network_passphrase } = request.body;
          const { data, error } = await submitTransaction(
            signed_xdr,
            network_url,
            network_passphrase
          );
          if (error) {
            reply.code(400).send(JSON.stringify(error));
          } else {
            reply.code(200).send(data);
          }
        },
      });

      instance.route({
        method: "POST",
        url: "/simulate-tx",
        schema: {
          body: {
            type: "object",
            properties: {
              signed_xdr: { type: "string" },
              network_url: { type: "string" },
              network_passphrase: { type: "string" },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Body: {
              signed_xdr: string;
              network_url: string;
              network_passphrase: string;
            };
          }>,
          reply
        ) => {
          const { signed_xdr, network_url, network_passphrase } = request.body;

          try {
            const tx = TransactionBuilder.fromXDR(
              signed_xdr,
              network_passphrase
            );
            const server = new SorobanRpc.Server(network_url);

            const data = await simulateTx<unknown>(
              tx as Transaction<Memo<MemoType>, Operation[]>,
              server
            );
            reply.code(200).send(data);
          } catch (error) {
            reply.code(400).send(JSON.stringify(error));
          }
        },
      });

      instance.route({
        method: "POST",
        url: "/simulate-token-transfer",
        schema: {
          body: {
            type: "object",
            properties: {
              address: { type: "string" },
              pub_key: { type: "string" },
              memo: { type: "string" },
              fee: { type: "string" },
              params: { type: "object" },
              network_url: { type: "string" },
              network_passphrase: { type: "string" },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Body: {
              address: string;
              pub_key: string;
              memo: string;
              fee?: string;
              params: xdr.ScVal[];
              network_url: string;
              network_passphrase: string;
            };
          }>,
          reply
        ) => {
          const {
            address,
            pub_key,
            memo,
            fee,
            params,
            network_url,
            network_passphrase,
          } = request.body;

          try {
            const _fee = fee || BASE_FEE;
            const server = new SorobanRpc.Server(network_url, {
              allowHttp: network_url.startsWith("http://"),
            });
            const sourceAccount = await server.getAccount(pub_key);
            const builder = new TransactionBuilder(sourceAccount, {
              fee: _fee,
              networkPassphrase: network_passphrase,
            });
            const tx = buildTransfer(address, params, memo, builder);
            const simulationResponse = await simulateTx<unknown>(
              tx as Transaction<Memo<MemoType>, Operation[]>,
              server
            );
            const data = {
              simulationResponse,
              raw: tx.toXDR(),
            };
            reply.code(200).send(data);
          } catch (error) {
            reply.code(400).send(JSON.stringify(error));
          }
        },
      });

      next();
    },
    { prefix: `/api/${API_VERSION}` }
  );

  return server;
}
