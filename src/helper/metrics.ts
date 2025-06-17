import { FastifyReply, FastifyRequest } from "fastify";
import Prometheus from "prom-client";

export enum WorkerMessage {
  INTEGRITY_CHECK_PASS = "integrityCheckPass",
  INTEGRITY_CHECK_FAIL = "integrityCheckFail",
}

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

export const dataIntegrityCheckPass = new Prometheus.Counter({
  name: "freighter_backend_integrity_check_pass",
  help: "Count of times the integrity check has passed between Horizon <-> Mercury",
  labelNames: ["dataIntegrityCheckPass"],
  registers: [register],
});
export const dataIntegrityCheckFail = new Prometheus.Counter({
  name: "freighter_backend_integrity_check_fail",
  help: "Count of times the integrity check has failed between Horizon <-> Mercury",
  labelNames: ["dataIntegrityCheckFail"],
  registers: [register],
});

register.registerMetric(dataIntegrityCheckPass);
register.registerMetric(dataIntegrityCheckFail);

// Whitelist of valid Freighter API routes (without parameters)
const ROUTE_WHITELIST = [
  "/ping",
  "/price-worker-health",
  "/rpc-health",
  "/horizon-health",
  "/feature-flags",
  "/user-notification",
  "/account-history",
  "/account-balances",
  "/token-details",
  "/token-spec",
  "/contract-spec",
  "/is-sac-contract",
  "/scan-dapp",
  "/scan-tx",
  "/scan-asset",
  "/scan-asset-bulk",
  "/report-asset-warning",
  "/report-transaction-warning",
  "/token-prices",
  "/subscription/token",
  "/subscription/account",
  "/subscription/token-balance",
  "/submit-tx",
  "/simulate-tx",
  "/simulate-token-transfer",
  "/onramp/token",
];

export const httpLabelUrl = (url: string) => {
  const [route, search] = url.split("?");
  const params = new URLSearchParams(search);
  const network = params.get("network") || "unknown";

  // Extract the path without the /api/v1 prefix
  const pathMatch = route.match(/^\/api\/v\d+(.*)$/);
  const path = pathMatch ? pathMatch[1] : route;

  // Check for parameterized routes
  if (path.includes("/account-history/")) {
    return {
      route: "/account-history",
      network,
    };
  }

  if (path.includes("/account-balances/")) {
    return {
      route: "/account-balances",
      network,
    };
  }

  if (path.includes("/token-details/")) {
    return {
      route: "/token-details",
      network,
    };
  }

  if (path.includes("/token-spec/")) {
    return {
      route: "/token-spec",
      network,
    };
  }

  if (path.includes("/contract-spec/")) {
    return {
      route: "/contract-spec",
      network,
    };
  }

  if (path.includes("/is-sac-contract/")) {
    return {
      route: "/is-sac-contract",
      network,
    };
  }

  // Check if the exact path is in the whitelist
  if (ROUTE_WHITELIST.includes(path)) {
    return {
      route: path,
      network,
    };
  }

  // If not whitelisted, return "other" to prevent metric explosion
  return {
    route: "other",
    network,
  };
};

export const getHttpRequestDurationLabels = (
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const { route, network } = httpLabelUrl(request.url);
  return {
    method: request.method,
    route,
    network,
    status: reply.statusCode,
  };
};
