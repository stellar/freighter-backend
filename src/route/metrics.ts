import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimiter from "@fastify/rate-limit";
import cors from "@fastify/cors";
import { Redis } from "ioredis";
import Prometheus from "prom-client";

export async function initMetricsServer(
  register: Prometheus.Registry,
  redis?: Redis,
) {
  const server = Fastify();
  server.register(rateLimiter, {
    max: 350,
    timeWindow: "1 minute",
    redis,
  });

  server.register(helmet, { global: true });
  await server.register(cors, {
    origin: "*",
  });

  server.register((instance, _opts, next) => {
    instance.route({
      method: "GET",
      url: "/metrics",
      handler: async (_request, reply) => {
        reply.header("Content-Type", register.contentType);
        const data = await register.metrics();
        reply.code(200).send(data);
      },
    });
    next();
  });

  return server;
}
