# Backend Docs

Use this directory as the operator and maintainer entry point for the backend.

| Document                             | Purpose                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| [architecture.md](./architecture.md) | Runtime topology, major components, data flow, and build artifacts             |
| [runbook.md](./runbook.md)           | Startup steps, required configuration, health checks, and incident playbooks   |
| [workers.md](./workers.md)           | Background worker lifecycle, Redis keys, restart behavior, and manual recovery |
| [metrics.md](./metrics.md)           | Prometheus endpoint details, emitted metrics, labels, and scraping notes       |
| [debugging.md](./debugging.md)       | Logs, source maps, Redis inspection, and common failure patterns               |
| [mercury.md](./mercury.md)           | Mercury-specific integration details, playground notes, and query guidance     |

Suggested reading order for new contributors:

1. [architecture.md](./architecture.md)
2. [runbook.md](./runbook.md)
3. [workers.md](./workers.md)
4. [metrics.md](./metrics.md)
5. [debugging.md](./debugging.md)
