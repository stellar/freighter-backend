import { FastifyReply, FastifyRequest } from "fastify";

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
