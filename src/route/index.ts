import Fastify, { FastifyRequest } from "fastify";
import axios from "axios";
import helmet from "@fastify/helmet";
import rateLimiter from "@fastify/rate-limit";
import cors from "@fastify/cors";
import { Logger } from "pino";
import { Redis } from "ioredis";
import Prometheus from "prom-client";
import { Networks } from "stellar-sdk-next";
import * as StellarSdk from "stellar-sdk";

import { MercuryClient } from "../service/mercury";
import {
  BlockAidService,
  BlockaidAssetScanResponse,
} from "../service/blockaid";
import {
  addScannedStatus,
  defaultBenignResponse,
} from "../service/blockaid/helpers/addScanResults";
import { ajv } from "./validators";
import {
  isContractId,
  isPubKey,
  isNetwork,
  NetworkNames,
} from "../helper/validate";
import { NETWORK_URLS, submitTransaction } from "../helper/horizon-rpc";
import {
  SOROBAN_RPC_URLS,
  buildTransfer,
  getContractSpec,
  getIsTokenSpec,
  isSacContractExecutable,
} from "../helper/soroban-rpc";
import { ERROR } from "../helper/error";
import { getSdk } from "../helper/stellar";
import { getUseMercury } from "../helper/mercury";
import { getHttpRequestDurationLabels } from "../helper/metrics";
import { mode } from "../helper/env";
import Blockaid from "@blockaid/client";
import { PriceClient } from "../service/prices";
import { TokenPriceData } from "../service/prices/types";

const API_VERSION = "v1";

export async function initApiServer(
  mercuryClient: MercuryClient,
  blockAidService: BlockAidService,
  priceClient: PriceClient,
  logger: Logger,
  useMercuryConf: boolean,
  useSorobanPublic: boolean,
  register: Prometheus.Registry,
  mode: mode,
  blockaidConfig: {
    useBlockaidDappScanning: boolean;
    useBlockaidTxScanning: boolean;
    useBlockaidAssetScanning: boolean;
  },
  redis?: Redis,
) {
  const routeMetricsStore = new WeakMap<
    FastifyRequest,
    (labels?: Prometheus.LabelValues<string>) => number
  >();
  const httpRequestDurationMicroseconds = new Prometheus.Histogram({
    name: "http_request_duration_s",
    help: "Duration of HTTP requests in seconds",
    labelNames: ["method", "route", "status", "network"],
    buckets: [0.1, 0.5, 1, 2, 5],
    registers: [register],
  });
  register.registerMetric(httpRequestDurationMicroseconds);

  const server = Fastify({
    loggerInstance: logger,
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

  server.addHook("onRequest", (request, _, done) => {
    routeMetricsStore.set(
      request,
      httpRequestDurationMicroseconds.startTimer(),
    );
    return done();
  });

  server.addHook("onResponse", (request, reply, done) => {
    const histMetric = routeMetricsStore.get(request);
    if (!histMetric) {
      return done();
    }

    const labels = getHttpRequestDurationLabels(request, reply);
    histMetric(labels);
    return done();
  });

  server.register(
    function (instance, _opts, next) {
      instance.route({
        method: "GET",
        url: "/ping",
        handler: async (_request, reply) => {
          reply.code(200).send("Alive!");
        },
      });

      instance.route({
        method: "GET",
        url: "/rpc-health",
        schema: {
          querystring: {
            type: "object",
            required: ["network"],
            properties: {
              ["network"]: {
                type: "string",
                validator: (qStr: string) => isNetwork(qStr),
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Querystring: {
              ["network"]: NetworkNames;
            };
          }>,
          reply,
        ) => {
          const networkUrl = SOROBAN_RPC_URLS[request.query.network];

          if (!networkUrl) {
            return reply.code(400).send("Unknown network");
          }

          const Sdk = getSdk(StellarSdk.Networks[request.query.network]);
          const { SorobanRpc } = Sdk;

          try {
            const server = new SorobanRpc.Server(networkUrl, {
              allowHttp: networkUrl.startsWith("http://"),
            });

            const health = await server.getHealth();
            reply.code(200).send(health);
          } catch (error) {
            reply.code(200).send({ status: "unhealthy", error });
          }
        },
      });

      instance.route({
        method: "GET",
        url: "/horizon-health",
        schema: {
          querystring: {
            type: "object",
            required: ["network"],
            properties: {
              ["network"]: {
                type: "string",
                validator: (qStr: string) => isNetwork(qStr),
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Querystring: {
              ["network"]: NetworkNames;
            };
          }>,
          reply,
        ) => {
          const networkUrl = NETWORK_URLS[request.query.network];

          if (!networkUrl) {
            return reply.code(400).send("Unknown network");
          }

          try {
            // cant use the horizon class from sdk, does not expose health)
            const health = await axios.get(`${networkUrl}/health`);
            reply.code(200).send(health.data);
          } catch (error) {
            reply.code(500).send({
              database_connected: null,
              core_up: null,
              core_synced: null,
            });
          }
        },
      });

      instance.route({
        method: "GET",
        url: "/feature-flags",
        handler: async (_request, reply) => {
          reply.code(200).send({ useSorobanPublic });
        },
      });

      instance.route({
        method: "GET",
        url: "/user-notification",
        handler: async (_request, reply) => {
          const response = {
            enabled: false,
            message: "",
          };
          reply.code(200).send(response);
        },
      });

      instance.route({
        method: "GET",
        url: "/account-history/:pubKey",
        schema: {
          params: {
            type: "object",
            required: ["pubKey"],
            properties: {
              ["pubKey"]: {
                type: "string",
                validator: (pubKey: string) => isPubKey(pubKey),
              },
            },
          },
          querystring: {
            type: "object",
            required: ["network"],
            properties: {
              ["network"]: {
                type: "string",
                validator: (qStr: string) => isNetwork(qStr),
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Params: { ["pubKey"]: string };
            Querystring: {
              ["network"]: NetworkNames;
            };
          }>,
          reply,
        ) => {
          try {
            const useMercury = await getUseMercury(mode, useMercuryConf, redis);
            const pubKey = request.params["pubKey"];
            const { network } = request.query;
            const { data, error } = await mercuryClient.getAccountHistory(
              pubKey,
              network,
              useMercury,
            );
            if (error) {
              reply.code(400).send(JSON.stringify(error));
            } else {
              reply.code(200).send(data);
            }
          } catch (error) {
            logger.error(error);
            reply.code(500).send(ERROR.SERVER_ERROR);
          }
        },
      });

      instance.route({
        method: "GET",
        url: "/account-balances/:pubKey",
        schema: {
          params: {
            type: "object",
            required: ["pubKey"],
            properties: {
              ["pubKey"]: {
                type: "string",
                validator: (pubKey: string) => isPubKey(pubKey),
              },
            },
          },
          querystring: {
            type: "object",
            required: ["network"],
            properties: {
              ["contract_ids"]: {
                type: "array",
                validator: (qStr: Array<unknown>) =>
                  qStr.map((q) => String(q)).every(isContractId),
              },
              ["network"]: {
                type: "string",
                validator: (qStr: string) => isNetwork(qStr),
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Params: { ["pubKey"]: string };
            Querystring: {
              ["contract_ids"]: string[];
              ["network"]: NetworkNames;
            };
          }>,
          reply,
        ) => {
          try {
            const useMercury = await getUseMercury(mode, useMercuryConf, redis);
            const pubKey = request.params["pubKey"];
            const { network } = request.query;

            const skipSorobanPubnet = network === "PUBLIC" && !useSorobanPublic;
            const contractIds =
              request.query["contract_ids"] || ([] as string[]);

            // this returns a composite error/response so we always pass through the whole thing and let the client pick out data/errors.
            const data = await mercuryClient.getAccountBalances(
              pubKey,
              skipSorobanPubnet ? [] : contractIds,
              network,
              useMercury,
            );

            try {
              data.balances = await addScannedStatus(
                data.balances,
                blockAidService,
                network,
                logger,
                blockaidConfig.useBlockaidAssetScanning,
              );
            } catch (e) {
              const scannedBalances = {} as {
                [key: string]: {
                  blockaidData: Blockaid.Token.TokenScanResponse;
                };
              };
              for (const balanceKey of Object.keys(data.balances)) {
                scannedBalances[balanceKey] = {
                  ...data.balances[balanceKey],
                  blockaidData: {
                    ...defaultBenignResponse,
                  },
                };
              }
              data.balances = scannedBalances;
              logger.error(e);
            }

            reply.code(200).send(data);
          } catch (error) {
            logger.error(error);
            reply.code(500).send(ERROR.SERVER_ERROR);
          }
        },
      });

      instance.route({
        method: "GET",
        url: "/token-details/:contractId",
        schema: {
          params: {
            type: "object",
            required: ["contractId"],
            properties: {
              ["contractId"]: {
                type: "string",
                validator: (qStr: string) => isContractId(qStr),
              },
            },
          },
          querystring: {
            type: "object",
            required: ["pub_key", "network"],
            properties: {
              ["pub_key"]: {
                type: "string",
                validator: (pubKey: string) => isPubKey(pubKey),
              },
              ["network"]: {
                type: "string",
                validator: (qStr: string) => isNetwork(qStr),
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Params: { ["contractId"]: string };
            Querystring: {
              ["pub_key"]: string;
              ["network"]: NetworkNames;
            };
          }>,
          reply,
        ) => {
          const contractId = request.params["contractId"];
          const { network, pub_key } = request.query;

          const skipSorobanPubnet = network === "PUBLIC" && !useSorobanPublic;
          if (skipSorobanPubnet) {
            return reply.code(400).send("Soroban has been disabled on pubnet");
          }

          try {
            const data = await mercuryClient.tokenDetails(
              pub_key,
              contractId,
              network,
            );
            reply.code(200).send(data);
          } catch (error) {
            reply.code(400).send(error);
          }
        },
      });

      instance.route({
        method: "GET",
        url: "/token-spec/:contractId",
        schema: {
          params: {
            type: "object",
            required: ["contractId"],
            properties: {
              ["contractId"]: {
                type: "string",
                validator: (qStr: string) => isContractId(qStr),
              },
            },
          },
          querystring: {
            type: "object",
            required: ["network"],
            properties: {
              ["network"]: {
                type: "string",
                validator: (qStr: string) => isNetwork(qStr),
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Params: { ["contractId"]: string };
            Querystring: {
              ["network"]: NetworkNames;
            };
          }>,
          reply,
        ) => {
          const contractId = request.params["contractId"];
          const { network } = request.query;

          const skipSorobanPubnet = network === "PUBLIC" && !useSorobanPublic;
          if (skipSorobanPubnet) {
            return reply.code(400).send("Soroban has been disabled on pubnet");
          }

          try {
            const isToken = await getIsTokenSpec(contractId, network, logger);

            reply.code(200).send({ data: isToken, error: null });
          } catch (error) {
            reply.code(500).send("Unexpected Server Error");
          }
        },
      });

      instance.route({
        method: "GET",
        url: "/contract-spec/:contractId",
        schema: {
          params: {
            type: "object",
            required: ["contractId"],
            properties: {
              ["contractId"]: {
                type: "string",
                validator: (qStr: string) => isContractId(qStr),
              },
            },
          },
          querystring: {
            type: "object",
            required: ["network"],
            properties: {
              ["network"]: {
                type: "string",
                validator: (qStr: string) => isNetwork(qStr),
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Params: { ["contractId"]: string };
            Querystring: {
              ["network"]: NetworkNames;
            };
          }>,
          reply,
        ) => {
          const contractId = request.params["contractId"];
          const { network } = request.query;

          const skipSorobanPubnet = network === "PUBLIC" && !useSorobanPublic;
          if (skipSorobanPubnet) {
            return reply.code(400).send("Soroban has been disabled on pubnet");
          }

          try {
            const { result, error } = await getContractSpec(
              contractId,
              network,
              logger,
            );

            reply.code(error ? 400 : 200).send({ data: result, error });
          } catch (error) {
            reply.code(500).send("Unexpected Server Error");
          }
        },
      });

      instance.route({
        method: "GET",
        url: "/is-sac-contract/:contractId",
        schema: {
          params: {
            type: "object",
            required: ["contractId"],
            properties: {
              ["contractId"]: {
                type: "string",
                validator: (qStr: string) => isContractId(qStr),
              },
            },
          },
          querystring: {
            type: "object",
            required: ["network"],
            properties: {
              ["network"]: {
                type: "string",
                validator: (qStr: string) => isNetwork(qStr),
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Params: { ["contractId"]: string };
            Querystring: {
              ["network"]: NetworkNames;
            };
          }>,
          reply,
        ) => {
          const contractId = request.params["contractId"];
          const { network } = request.query;

          const skipSorobanPubnet = network === "PUBLIC" && !useSorobanPublic;
          if (skipSorobanPubnet) {
            return reply.code(400).send("Soroban has been disabled on pubnet");
          }

          try {
            const isSacContract = await isSacContractExecutable(
              contractId,
              network,
            );

            reply.code(200).send({ isSacContract });
          } catch (error) {
            reply.code(500).send(ERROR.SERVER_ERROR);
          }
        },
      });

      instance.route({
        method: "GET",
        url: "/scan-dapp",
        schema: {
          querystring: {
            type: "object",
            required: ["url"],
            properties: {
              ["url"]: {
                type: "string",
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Querystring: {
              ["url"]: string;
            };
          }>,
          reply,
        ) => {
          const { url } = request.query;
          if (blockaidConfig.useBlockaidDappScanning) {
            try {
              const { data, error } = await blockAidService.scanDapp(url);
              return reply.code(error ? 400 : 200).send({ data, error });
            } catch (error) {
              return reply.code(500).send(ERROR.SERVER_ERROR);
            }
          }
          return reply.code(200).send({
            data: { status: "miss" },
            error: ERROR.SCAN_SITE_DISABLED,
          });
        },
      });

      instance.route({
        method: "GET",
        url: "/scan-tx",
        schema: {
          querystring: {
            type: "object",
            required: ["tx_xdr", "url", "network"],
            properties: {
              ["tx_xdr"]: {
                type: "string",
              },
              ["url"]: {
                type: "string",
              },
              ["network"]: {
                type: "string",
                validator: (qStr: string) => isNetwork(qStr),
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Querystring: {
              ["tx_xdr"]: string;
              ["url"]: string;
              ["network"]: NetworkNames;
            };
          }>,
          reply,
        ) => {
          const { tx_xdr, url, network } = request.query;
          if (blockaidConfig.useBlockaidTxScanning) {
            try {
              const { data, error } = await blockAidService.scanTx(
                tx_xdr,
                url,
                network,
              );
              return reply.code(error ? 400 : 200).send({ data, error });
            } catch (error) {
              return reply.code(500).send(ERROR.SERVER_ERROR);
            }
          }
          return reply
            .code(200)
            .send({ data: null, error: ERROR.SCAN_TX_DISABLED });
        },
      });

      instance.route({
        method: "GET",
        url: "/scan-asset",
        schema: {
          querystring: {
            type: "object",
            required: ["address"],
            properties: {
              ["address"]: {
                type: "string",
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Querystring: {
              ["address"]: string;
            };
          }>,
          reply,
        ) => {
          const { address } = request.query;

          if (blockaidConfig.useBlockaidAssetScanning) {
            try {
              const { data, error } = await blockAidService.scanAsset(address);
              return reply.code(error ? 400 : 200).send({ data, error });
            } catch (error) {
              return reply.code(500).send(ERROR.SERVER_ERROR);
            }
          }
          return reply.code(200).send({
            data: { ...defaultBenignResponse, address },
            error: ERROR.SCAN_ASSET_DISABLED,
          });
        },
      });

      instance.route({
        method: "GET",
        url: "/scan-asset-bulk",
        schema: {
          querystring: {
            type: "object",
            required: ["asset_ids"],
            properties: {
              ["asset_ids"]: {
                type: "array",
                validator: (qStr: Array<unknown>) =>
                  qStr
                    .map((q) => String(q).split("-")[1])
                    .every((k) => isContractId(k) || isPubKey(k)),
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Querystring: {
              ["asset_ids"]: string[];
            };
          }>,
          reply,
        ) => {
          const { asset_ids } = request.query;
          if (blockaidConfig.useBlockaidAssetScanning) {
            try {
              const { data, error } =
                await blockAidService.scanAssetBulk(asset_ids);
              return reply.code(error ? 400 : 200).send({ data, error });
            } catch (error) {
              return reply.code(500).send(ERROR.SERVER_ERROR);
            }
          }
          const defaultResponse: {
            [addres: string]: BlockaidAssetScanResponse;
          } = {};
          asset_ids.forEach((address) => {
            defaultResponse[address] = {
              ...defaultBenignResponse,
            };
          });
          return reply.code(200).send({
            data: { results: defaultResponse },
            error: ERROR.SCAN_ASSET_DISABLED,
          });
        },
      });

      instance.route({
        method: "GET",
        url: "/token-prices",
        schema: {
          querystring: {
            type: "object",
            required: ["tokens"],
            properties: {
              ["tokens"]: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Querystring: {
              ["tokens"]: string[];
            };
          }>,
          reply,
        ) => {
          try {
            const { tokens } = request.query;
            const prices: { [key: string]: TokenPriceData | null } = {};

            // Get prices for all tokens in parallel
            await Promise.all(
              tokens.map(async (token) => {
                prices[token] = await priceClient.getPrice(token);
              }),
            );

            reply.code(200).send({ data: prices });
          } catch (error) {
            logger.error("Error getting token prices:", error);
            reply.code(500).send(ERROR.SERVER_ERROR);
          }
        },
      });

      instance.route({
        method: "POST",
        url: "/subscription/token",
        schema: {
          body: {
            type: "object",
            required: ["contract_id", "pub_key", "network"],
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
          reply,
        ) => {
          const { contract_id, pub_key, network } = request.body;
          const useMercury = await getUseMercury(mode, useMercuryConf, redis);
          if (!useMercury) {
            return reply.code(400).send(JSON.stringify("Mercury disabled"));
          }

          try {
            const { data, error } = await mercuryClient.tokenSubscription(
              contract_id,
              pub_key,
              network,
            );
            if (error) {
              reply.code(400).send(JSON.stringify(error));
            } else {
              reply.code(200).send(data);
            }
          } catch (error) {
            logger.error(error);
            return reply.code(500).send(ERROR.SERVER_ERROR);
          }
        },
      });

      instance.route({
        method: "POST",
        url: "/subscription/account",
        schema: {
          body: {
            type: "object",
            required: ["pub_key", "network"],
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
          reply,
        ) => {
          const { pub_key, network } = request.body;
          const useMercury = await getUseMercury(mode, useMercuryConf, redis);
          if (!useMercury) {
            return reply.code(400).send(JSON.stringify("Mercury disabled"));
          }

          try {
            const { data, error } = await mercuryClient.accountSubscription(
              pub_key,
              network,
            );
            if (error) {
              reply.code(400).send(JSON.stringify(error));
            } else {
              reply.code(200).send(data);
            }
          } catch (error) {
            logger.error(error);
            return reply.code(500).send(ERROR.SERVER_ERROR);
          }
        },
      });

      instance.route({
        method: "POST",
        url: "/subscription/token-balance",
        schema: {
          body: {
            type: "object",
            required: ["contract_id", "pub_key", "network"],
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
          reply,
        ) => {
          const { pub_key, contract_id, network } = request.body;

          const useMercury = await getUseMercury(mode, useMercuryConf, redis);
          if (!useMercury) {
            return reply.code(400).send(JSON.stringify("Mercury disabled"));
          }

          try {
            const { data, error } =
              await mercuryClient.tokenBalanceSubscription(
                contract_id,
                pub_key,
                network,
              );
            if (error) {
              reply.code(400).send(JSON.stringify(error));
            } else {
              reply.code(200).send(data);
            }
          } catch (error) {
            logger.error(error);
            return reply.code(500).send(ERROR.SERVER_ERROR);
          }
        },
      });

      instance.route({
        method: "POST",
        url: "/submit-tx",
        schema: {
          body: {
            type: "object",
            required: ["signed_xdr", "network_url", "network_passphrase"],
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
          reply,
        ) => {
          const { signed_xdr, network_url, network_passphrase } = request.body;
          try {
            const { data, error } = await submitTransaction(
              signed_xdr,
              network_url,
              network_passphrase,
            );
            if (error) {
              reply.code(400).send(JSON.stringify(error));
            } else {
              reply.code(200).send(data);
            }
          } catch (error) {
            logger.error(error);
            return reply.code(500).send(ERROR.SERVER_ERROR);
          }
        },
      });

      instance.route({
        method: "POST",
        url: "/simulate-tx",
        schema: {
          body: {
            type: "object",
            required: ["xdr", "network_url", "network_passphrase"],
            properties: {
              xdr: { type: "string" },
              network_url: { type: "string" },
              network_passphrase: { type: "string" },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Body: {
              xdr: string;
              network_url: string;
              network_passphrase: string;
            };
          }>,
          reply,
        ) => {
          const { xdr, network_url, network_passphrase } = request.body;

          try {
            const Sdk = getSdk(network_passphrase as Networks);
            const tx = Sdk.TransactionBuilder.fromXDR(xdr, network_passphrase);
            const server = new Sdk.SorobanRpc.Server(network_url);
            const simulationResponse = await server.simulateTransaction(tx);
            const preparedTransaction = Sdk.SorobanRpc.assembleTransaction(
              tx,
              simulationResponse,
            )
              .build()
              .toXDR();

            const data = {
              simulationResponse,
              preparedTransaction,
            };
            reply.code(200).send(data);
          } catch (error) {
            logger.error(JSON.stringify(error));
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
            required: [
              "address",
              "pub_key",
              "memo",
              "params",
              "network_url",
              "network_passphrase",
            ],
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
              params: Record<string, string>;
              network_url: string;
              network_passphrase: string;
            };
          }>,
          reply,
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
            const Sdk = getSdk(network_passphrase as Networks);
            const _fee = fee || Sdk.BASE_FEE;
            const server = new Sdk.SorobanRpc.Server(network_url, {
              allowHttp: network_url.startsWith("http://"),
            });
            const sourceAccount = await server.getAccount(pub_key);
            const builder = new Sdk.TransactionBuilder(sourceAccount, {
              fee: _fee,
              networkPassphrase: network_passphrase,
            });
            const _params = [
              new Sdk.Address(params.publicKey).toScVal(), // from
              new Sdk.Address(params.destination).toScVal(), // to
              new Sdk.XdrLargeInt("i128", params.amount).toI128(), // amount
            ];
            const tx = buildTransfer(
              address,
              _params,
              memo,
              builder,
              network_passphrase as Networks,
            );
            const simulationResponse = (await server.simulateTransaction(
              tx,
            )) as StellarSdk.SorobanRpc.Api.SimulateTransactionSuccessResponse;

            const preparedTransaction = Sdk.SorobanRpc.assembleTransaction(
              tx,
              simulationResponse,
            );

            const built = preparedTransaction.build();
            switch (built.operations[0].type) {
              case "invokeHostFunction": {
                const sorobanOp = built
                  .operations[0] as StellarSdk.Operation.InvokeHostFunction;
                const auths = sorobanOp.auth || [];

                for (const auth of auths) {
                  if (
                    auth.credentials().switch() !==
                    Sdk.xdr.SorobanCredentialsType.sorobanCredentialsSourceAccount()
                  ) {
                    throw new Error(ERROR.ACCOUNT_NOT_SOURCE);
                  }

                  if (auth.rootInvocation().subInvocations().length) {
                    throw new Error(ERROR.AUTH_SUB_INVOCATIONS);
                  }
                }
              }
            }

            const data = {
              simulationResponse,
              preparedTransaction: built.toXDR(),
            };
            reply.code(200).send(data);
          } catch (error) {
            reply.code(400).send(error);
          }
        },
      });

      next();
    },
    { prefix: `/api/${API_VERSION}` },
  );

  return server;
}
