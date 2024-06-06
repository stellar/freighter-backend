import { FastifyReply, FastifyRequest } from "fastify";

export const httpLabelUrl = (method: string) => {
  const [route, search] = method.split("?");
  const params = new URLSearchParams(search);
  const network = params.get("network") || "unknown";

  if (method.includes("account-history")) {
    return {
      route: "account-history",
      network,
    };
  }

  if (method.includes("account-balances")) {
    return {
      route: "account-balances",
      network,
    };
  }

  if (method.includes("token-details")) {
    return {
      route: "token-details",
      network,
    };
  }

  if (method.includes("token-spec")) {
    return {
      route: "token-spec",
      network,
    };
  }

  if (method.includes("contract-spec")) {
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
  const { route, network } = httpLabelUrl(request.method);
  return {
    method: request.method,
    route,
    network,
    status: reply.statusCode,
  };
};
