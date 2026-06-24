import { FastifyRequest, FastifyReply } from "fastify";
import { Redis } from "ioredis";
import { AuthMode } from "./mode";
import { ONRAMP_AUTH_REASON } from "./errors";
import { verifyOnrampProof } from "./verifier";
import { enforcePrincipalRateLimit } from "./rate-limit";
import { setOnrampPrincipal } from "./context";
import { recordOnrampAuth } from "../helper/metrics";

// Mirrors freighter-backend-v2 internal/api/middleware/auth.go Auth(...):
// verify the onramp proof, apply the rollout mode, record the {result,reason}
// metric, enforce the per-principal rate limit, and stash the principal.
export const onrampAuthPreHandler =
  ({ mode, redis }: { mode: AuthMode; redis?: Redis }) =>
  async (request: FastifyRequest, reply: FastifyReply) => {
    const result = verifyOnrampProof({
      authorization: request.headers.authorization,
      method: request.method,
      path: request.url.split("?")[0],
      body: request.body ?? {},
      nowSeconds: Math.floor(Date.now() / 1000),
    });

    if (!result.ok) {
      // Permissive: a request with NO proof passes through anonymously (legacy path);
      // any present-but-invalid proof is ALWAYS rejected.
      if (
        mode === "permissive" &&
        result.reason === ONRAMP_AUTH_REASON.NO_TOKEN
      ) {
        recordOnrampAuth("anonymous", ONRAMP_AUTH_REASON.NO_TOKEN);
        return;
      }
      recordOnrampAuth("rejected", result.reason);
      return reply.code(result.status).send({ error: result.error });
    }

    const allowed = await enforcePrincipalRateLimit(redis, result.sub);
    if (!allowed) {
      recordOnrampAuth("rejected", ONRAMP_AUTH_REASON.RATE_LIMITED);
      return reply.code(429).send({ error: "Too many onramp token requests" });
    }

    recordOnrampAuth("authenticated", "ok");
    setOnrampPrincipal(request, result.sub);
  };
