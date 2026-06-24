import { FastifyRequest, FastifyReply } from "fastify";
import { AuthMode } from "./mode";
import { ONRAMP_AUTH_REASON } from "./errors";
import { verifyOnrampProof } from "./verifier";
import { recordOnrampAuth } from "../helper/metrics";
import "./context"; // augments FastifyRequest with onrampPrincipal

// Mirrors freighter-backend-v2 internal/api/middleware/auth.go Auth(...):
// verify the onramp proof, apply the rollout mode, record the {result,reason}
// metric, and stash the proven principal on the request.
export const onrampAuthPreHandler =
  ({ mode }: { mode: AuthMode }) =>
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

    recordOnrampAuth("authenticated", ONRAMP_AUTH_REASON.OK);
    request.onrampPrincipal = result.sub;
  };
