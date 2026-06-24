// Module augmentation for the per-request onramp principal. The onramp auth
// preHandler sets `request.onrampPrincipal` to the Stellar address whose
// ownership the caller proved; the route handler reads it. `null` for
// unauthenticated (permissive-mode, no-proof) requests. The field is registered
// at server creation via `server.decorateRequest("onrampPrincipal", null)`.
declare module "fastify" {
  interface FastifyRequest {
    onrampPrincipal: string | null;
  }
}

export {};
