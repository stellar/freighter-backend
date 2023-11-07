import Fastify, { FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import rateLimiter from "@fastify/rate-limit";
import { Logger } from "pino";
import { Redis } from "ioredis";

import { MercuryClient } from "../service/mercury";
import { ajv } from "./validators";
import { isContractId, isPubKey } from "../helper/validate";

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
        },
        handler: async (
          request: FastifyRequest<{
            Params: { ["pubKey"]: string };
          }>,
          reply
        ) => {
          const pubKey = request.params["pubKey"];
          const { data, error } = await mercuryClient.getAccountHistory(pubKey);
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
              validator: (qStr: string) => qStr.split(",").some(isContractId),
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Params: { ["pubKey"]: string };
            Querystring: { ["contract_ids"]: string };
          }>,
          reply
        ) => {
          const pubKey = request.params["pubKey"];
          const contractIds = request.query["contract_ids"].split(",");
          const { data, error } = await mercuryClient.getAccountBalances(
            pubKey,
            contractIds
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
            Body: { contract_id: string; pub_key: string };
          }>,
          reply
        ) => {
          const { contract_id, pub_key } = request.body;
          const { data, error } = await mercuryClient.tokenSubscription(
            contract_id,
            pub_key
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
          request: FastifyRequest<{ Body: { pub_key: string } }>,
          reply
        ) => {
          const { pub_key } = request.body;
          const { data, error } = await mercuryClient.accountSubscription(
            pub_key
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
            Body: { pub_key: string; contract_id: string };
          }>,
          reply
        ) => {
          const { pub_key, contract_id } = request.body;
          const { data, error } = await mercuryClient.tokenBalanceSubscription(
            contract_id,
            pub_key
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
