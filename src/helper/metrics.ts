import { FastifyReply, FastifyRequest } from "fastify";
import Prometheus from "prom-client";

export const register = new Prometheus.Registry();
register.setDefaultLabels({
  app: "freighter-backend",
});

export const mercuryErrorCounter = new Prometheus.Counter({
  name: "freighter_backend_mercury_error_count",
  help: "Count of errors returned from Mercury",
  labelNames: ["endpoint"],
  registers: [register],
});

export const rpcErrorCounter = new Prometheus.Counter({
  name: "freighter_backend_rpc_error_count",
  help: "Count of errors returned from Horizon or Soroban RPCs",
  labelNames: ["rpc"],
  registers: [register],
});

export const criticalError = new Prometheus.Counter({
  name: "freighter_backend_critical_error_count",
  help: "Count of errors that need manual operator intervention or investigation",
  labelNames: ["message"],
  registers: [register],
});

export const httpLabelUrl = (url: string) => {
  const [route, search] = url.split("?");
  const params = new URLSearchParams(search);
  const network = params.get("network") || "unknown";

  if (url.includes("account-history")) {
    return {
      route: "account-history",
      network,
    };
  }

  if (url.includes("account-balances")) {
    return {
      route: "account-balances",
      network,
    };
  }

  if (url.includes("token-details")) {
    return {
      route: "token-details",
      network,
    };
  }

  if (url.includes("token-spec")) {
    return {
      route: "token-spec",
      network,
    };
  }

  if (url.includes("contract-spec")) {
    return {
      route: "contract-spec",
      network,
    };
  }

  return {
    route,
    network,
  };
};

export const getHttpRequestDurationLabels = (
  request: FastifyRequest,
  reply: FastifyReply
) => {
  const { route, network } = httpLabelUrl(request.url);
  return {
    method: request.method,
    route,
    network,
    status: reply.statusCode,
  };
};
