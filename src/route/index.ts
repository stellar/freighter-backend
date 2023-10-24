import Fastify, { FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";

import { MercuryClient } from "../service/mercury";

const API_VERSION = "v1";

export function initApiServer(mercuryClient: MercuryClient) {
  const server = Fastify({
    logger: true,
  });

  server.register(helmet, { global: true });
  server.register(
    (instance, _opts, next) => {
      instance.route({
        method: "GET",
        url: "/account-history/:pub-key",
        schema: {
          params: {
            ["pub-key"]: { type: "string" },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Params: { ["pub-key"]: string };
          }>,
          reply
        ) => {
          const pubKey = request.params["pub-key"];
          const { data, error } = await mercuryClient.getAccountHistory(pubKey);
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
          const { data, error } = await mercuryClient.addNewTokenSubscription(
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
          const { data, error } = await mercuryClient.addNewAccountSubscription(
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
