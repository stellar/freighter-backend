import Fastify, { FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import rateLimiter from "@fastify/rate-limit";
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

const API_VERSION = "v1";

export function initApiServer(
  mercuryClient: MercuryClient,
  logger: Logger,
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
            { horizon: horizon_url, soroban: soroban_url }
          );
          if (error) {
            reply.code(400).send(error);
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
            { horizon: horizon_url, soroban: soroban_url }
          );
          if (error) {
            reply.code(400).send(error);
          } else {
            reply.code(200).send(data);
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
          const { data, error } = await mercuryClient.tokenSubscription(
            contract_id,
            pub_key,
            network
          );
          if (error) {
            reply.code(400).send(error);
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
          const { data, error } = await mercuryClient.accountSubscription(
            pub_key,
            network
          );
          if (error) {
            reply.code(400).send(error);
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
          const { data, error } = await mercuryClient.tokenBalanceSubscription(
            contract_id,
            pub_key,
            network
          );
          if (error) {
            reply.code(400).send(error);
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
            reply.code(400).send(error);
          } else {
            reply.code(200).send(data);
          }
        },
      });

      next();
    },
    { prefix: `/api/${API_VERSION}` }
  );

  return server;
}
