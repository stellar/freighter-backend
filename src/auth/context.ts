import { FastifyRequest } from "fastify";

type WithOnrampPrincipal = FastifyRequest & { onrampPrincipal?: string };

export const setOnrampPrincipal = (
  request: FastifyRequest,
  sub: string,
): void => {
  (request as WithOnrampPrincipal).onrampPrincipal = sub;
};

export const getOnrampPrincipal = (
  request: FastifyRequest,
): string | undefined => (request as WithOnrampPrincipal).onrampPrincipal;
