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
import proxyaddr from "proxy-addr";

import { MercuryClient } from "../service/mercury";
import {
  BlockAidService,
  BlockaidAssetScanResponse,
  ReportTransactionWarningEvent,
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
  isValidTokenString,
} from "../helper/validate";
import { NETWORK_URLS, submitTransaction } from "../helper/horizon-rpc";
import {
  buildTransfer,
  getContractSpec,
  getIsTokenSpec,
  getStellarRpcUrls,
  isSacContractExecutable,
} from "../helper/soroban-rpc";
import { ERROR } from "../helper/error";
import { getSdk } from "../helper/stellar";
import { getUseMercury } from "../helper/mercury";
import { getHttpRequestDurationLabels } from "../helper/metrics";
import { mode } from "../helper/env";
import { fetchOnrampSessionToken, CoinbaseConfig } from "../helper/onramp";
import Blockaid from "@blockaid/client";
import { PriceClient } from "../service/prices";
import { TokenPriceData } from "../service/prices/types";
import { ensureError } from "../service/prices/errors";
import { PriceConfig, StellarRpcConfig } from "../config";

const API_VERSION = "v1";
const TOKEN_PRICES_BATCH_SIZE = 50;
const TOKEN_PRICES_MIN_REQUEST_SIZE = 1;
const TOKEN_PRICES_MAX_REQUEST_SIZE = 1000;

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
    useBlockaidAssetWarningReporting: boolean;
    useBlockaidTransactionWarningReporting: boolean;
  },
  coinbaseConfig: CoinbaseConfig,
  priceConfig: PriceConfig,
  stellarRpcConfig: StellarRpcConfig,
  trustProxyRange?: string,
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
    trustProxy: trustProxyRange && proxyaddr.compile(trustProxyRange),
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
        url: "/price-worker-health",
        handler: async (_request, reply) => {
          if (!redis) {
            return reply
              .code(503)
              .send({ status: "unhealthy", error: "Redis not available" });
          }

          try {
            // Check if price cache is initialized
            const isCacheInitialized = await redis.get(
              "price_cache_initialized",
            );
            if (!isCacheInitialized) {
              logger.error(
                "price worker health check: price cache not initialized",
              );
              return reply.code(503).send({
                status: "unhealthy",
              });
            }

            // Check horizon health
            const horizonHealthURL = `${priceConfig?.freighterHorizonUrl}/health`;
            const response = await fetch(horizonHealthURL);
            const data = await response.json();
            if (
              !(data.database_connected || data.core_up || data.core_synced)
            ) {
              logger.error(
                "price worker health check: horizon not healthy",
                data,
              );
              return reply.code(503).send({
                status: "unhealthy",
              });
            }

            // Check last update time
            const lastUpdateTime = await redis.get("price_worker_last_update");
            if (!lastUpdateTime) {
              logger.error(
                "price worker health check: no recent price updates",
              );
              return reply.code(503).send({
                status: "unhealthy",
              });
            }

            // Check if last update was within the expected interval
            if (priceConfig.priceStalenessThreshold > 0) {
              const maxUpdateInterval = priceConfig.priceStalenessThreshold;
              const lastUpdate = parseInt(lastUpdateTime);
              const timeSinceLastUpdate = Date.now() - lastUpdate;

              if (timeSinceLastUpdate > maxUpdateInterval) {
                logger.error(
                  `price worker health check: last cache update ${timeSinceLastUpdate / 1000}s ago`,
                );
                return reply.code(503).send({
                  status: "unhealthy",
                });
              }
            }

            reply.code(200).send({ status: "healthy" });
          } catch (error) {
            logger.error(error);
            reply.code(503).send({
              status: "unhealthy",
              error: "Error checking price worker health",
            });
          }
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
          const networkUrl =
            getStellarRpcUrls(stellarRpcConfig)[request.query.network];
          if (!networkUrl) {
            if (request.query.network === "PUBLIC") {
              return reply.code(400).send("RPC pubnet URL is not set");
            }
            return reply.code(400).send("Unknown network");
          }

          const Sdk = getSdk(StellarSdk.Networks[request.query.network]);
          const { rpc } = Sdk;

          try {
            const server = new rpc.Server(networkUrl, {
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
            enabled: true,
            message:
              "Coinbase Pay update: We’re currently noticing issues adding funds with Coinbase Pay. Please check back soon.",
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
              ["is_failed_included"]: {
                type: "string",
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Params: { ["pubKey"]: string };
            Querystring: {
              ["network"]: NetworkNames;
              ["is_failed_included"]: string;
            };
          }>,
          reply,
        ) => {
          try {
            const useMercury = await getUseMercury(mode, useMercuryConf, redis);
            const pubKey = request.params["pubKey"];
            const { network, is_failed_included: isFailedIncluded } =
              request.query;

            const { data, error } = await mercuryClient.getAccountHistory(
              pubKey,
              network,
              useMercury,
              isFailedIncluded === "true",
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
              ["should_fetch_balance"]: { type: "string" },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Params: { ["contractId"]: string };
            Querystring: {
              ["pub_key"]: string;
              ["network"]: NetworkNames;
              ["should_fetch_balance"]: string;
            };
          }>,
          reply,
        ) => {
          const contractId = request.params["contractId"];
          const { network, pub_key, should_fetch_balance } = request.query;

          const skipSorobanPubnet = network === "PUBLIC" && !useSorobanPublic;
          if (skipSorobanPubnet) {
            return reply.code(400).send("Soroban has been disabled on pubnet");
          }

          try {
            const data = await mercuryClient.tokenDetails(
              pub_key,
              contractId,
              network,
              should_fetch_balance === "true",
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
            const isToken = await getIsTokenSpec(
              contractId,
              network,
              logger,
              stellarRpcConfig,
            );

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
              stellarRpcConfig,
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
              stellarRpcConfig,
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

      // TODO: decomission this endpoint once all users have upgraded to Freighter 5.32.0
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
        method: "POST",
        url: "/scan-tx",
        schema: {
          body: {
            type: "object",
            required: ["url", "tx_xdr", "network"],
            properties: {
              url: { type: "string" },
              tx_xdr: { type: "string" },
              network: {
                type: "string",
                validator: (qStr: string) => isNetwork(qStr),
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Body: {
              url: string;
              tx_xdr: string;
              network: NetworkNames;
            };
          }>,
          reply,
        ) => {
          const { tx_xdr, url, network } = request.body;
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
        url: "/report-asset-warning",
        schema: {
          querystring: {
            type: "object",
            required: ["details", "address"],
            properties: {
              ["details"]: {
                type: "string",
              },
              ["address"]: {
                type: "string",
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Querystring: {
              ["details"]: string;
              ["address"]: string;
            };
          }>,
          reply,
        ) => {
          const { details, address } = request.query;

          if (blockaidConfig.useBlockaidAssetWarningReporting) {
            try {
              const { data, error } = await blockAidService.reportAssetWarning(
                details,
                address,
              );
              return reply.code(error ? 400 : 200).send({ data, error });
            } catch (error) {
              return reply.code(500).send({ error: ERROR.SERVER_ERROR });
            }
          }
          return reply.code(200).send({
            error: ERROR.REPORT_ASSET_DISABLED,
          });
        },
      });

      instance.route({
        method: "GET",
        url: "/report-transaction-warning",
        schema: {
          querystring: {
            type: "object",
            required: ["details", "request_id", "event"],
            properties: {
              ["details"]: {
                type: "string",
              },
              ["request_id"]: {
                type: "string",
              },
              ["event"]: {
                type: "string",
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Querystring: {
              ["details"]: string;
              ["request_id"]: string;
              ["event"]: ReportTransactionWarningEvent;
            };
          }>,
          reply,
        ) => {
          const { details, request_id, event } = request.query;

          if (blockaidConfig.useBlockaidTransactionWarningReporting) {
            try {
              const { data, error } =
                await blockAidService.reportTransactionWarning(
                  details,
                  request_id,
                  event,
                );
              return reply.code(error ? 400 : 200).send({ data, error });
            } catch (error) {
              return reply.code(500).send({ error: ERROR.SERVER_ERROR });
            }
          }
          return reply.code(200).send({
            error: ERROR.REPORT_TRANSACTION_DISABLED,
          });
        },
      });

      instance.route({
        method: "POST",
        url: "/token-prices",
        schema: {
          body: {
            type: "object",
            required: ["tokens"],
            properties: {
              tokens: {
                type: "array",
                minItems: TOKEN_PRICES_MIN_REQUEST_SIZE,
                maxItems: TOKEN_PRICES_MAX_REQUEST_SIZE,
                items: {
                  type: "string",
                  validator: (token: string) => isValidTokenString(token),
                },
              },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Body: {
              tokens: string[];
            };
          }>,
          reply,
        ) => {
          try {
            const { tokens } = request.body;
            const prices: { [key: string]: TokenPriceData | null } = {};

            for (let i = 0; i < tokens.length; i += TOKEN_PRICES_BATCH_SIZE) {
              const batch = tokens.slice(i, i + TOKEN_PRICES_BATCH_SIZE);
              await Promise.all(
                batch.map(async (token) => {
                  prices[token] = await priceClient.getPrice(token);
                }),
              );
            }

            reply.code(200).send({ data: prices });
          } catch (e) {
            const error = ensureError(e, "getting token prices");
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
            const server = await mercuryClient.getRpcServer(network_url);

            const simulationResponse = await server.simulateTransaction(tx);
            const preparedTransaction = Sdk.rpc
              .assembleTransaction(tx, simulationResponse)
              .build()
              .toXDR();

            const data = {
              simulationResponse,
              preparedTransaction,
            };
            reply.code(200).send(data);
          } catch (error) {
            let errorMessage = `Unknown error: ${JSON.stringify(error)}`;
            if (error instanceof Error) {
              errorMessage = `Error: ${error.name} - ${error.message}\n${error.stack}`;
            }
            logger.error(errorMessage);
            reply.code(400).send(errorMessage);
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
            const server = await mercuryClient.getRpcServer(network_url);
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
            )) as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse;

            const preparedTransaction = Sdk.rpc.assembleTransaction(
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

      instance.route({
        method: "POST",
        url: "/onramp/token",
        schema: {
          body: {
            type: "object",
            required: ["address"],
            properties: {
              address: { type: "string" },
            },
          },
        },
        handler: async (
          request: FastifyRequest<{
            Body: { address: string };
          }>,
          reply,
        ) => {
          const { address } = request.body;
          if (
            !coinbaseConfig.coinbaseApiKey ||
            !coinbaseConfig.coinbaseApiSecret
          ) {
            return reply.code(400).send({ error: "Coinbase config not set" });
          }

          try {
            const { data, error } = await fetchOnrampSessionToken({
              address,
              coinbaseConfig,
            });

            const { token } = data;

            if (!token) {
              return reply
                .code(400)
                .send({ error: `Unable to retrieve token: ${error}` });
            }

            // temporarily disable this endpoint
            return reply.code(200).send({
              data: { token: null, error: "Coinbase currently disabled" },
            });

            return reply.code(200).send({ data: { token } });
          } catch (error) {
            logger.error(error);
            return reply.code(500).send(ERROR.SERVER_ERROR);
          }
        },
      });

      next();
    },
    { prefix: `/api/${API_VERSION}` },
  );

  return server;
}
