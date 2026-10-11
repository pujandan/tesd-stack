# Production Readiness — Config, Logging, Health, Headers, CI/CD, Deployment

What must exist before a TESD application serves real traffic. Items marked **(required)** block a release.

## Contents

- [Configuration](#configuration)
- [Logging](#logging)
- [Health and Readiness](#health-and-readiness)
- [Graceful Shutdown](#graceful-shutdown)
- [Security Headers and CSP](#security-headers-and-csp)
- [Proxy, Limits, and Timeouts](#proxy-limits-and-timeouts)
- [Database Operations](#database-operations)
- [CI Pipeline](#ci-pipeline)
- [Docker and Container Compose](#docker-and-container-compose)
- [Release Checklist](#release-checklist)

## Configuration

1. **(required)** All configuration passes through `env.ts` ([design-patterns.md §7](./design-patterns.md#7-environment-adapter)): fail fast at boot on missing/invalid variables.
2. **(required)** `.env.example` lists every variable, with comments and placeholder values. `.env*` (except `.env.example`) are in `.gitignore`.
3. Required production variables for the default stack:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (`?sslmode=require` for managed databases) |
| `ORIGIN` | Public origin (`https://app.example.com`); used by adapter-node and the CSRF plugin |
| `LOG_LEVEL` | `info` in production |
| `PORT` / `HOST` | adapter-node listener (`0.0.0.0` in containers) |
| `BODY_SIZE_LIMIT` | Max request body (default 512 KB; set deliberately, e.g. `1M`) |
| `ADDRESS_HEADER` / `XFF_DEPTH` | How adapter-node derives the client IP behind your proxy (e.g. `X-Forwarded-For` / `1`) |
| `SHUTDOWN_TIMEOUT` | Seconds to drain connections on SIGTERM |

4. Config is **per environment**, injected by the platform (not baked into images or commits).

## Logging

Structured JSON logs through one logger; never `console.*` in server code.

```ts
// src/lib/server/logger.ts
import pino from 'pino'
import { env } from '$lib/server/env'

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: ['password', 'passwordHash', 'token', '*.password', '*.passwordHash', '*.token',
            'headers.authorization', 'headers.cookie', 'req.headers.authorization', 'req.headers.cookie'],
    censor: '[REDACTED]'
  }
})
```

Rules:

1. **(required)** Every request logs `requestId`, method, path, status, `durationMs` ([request-context plugin](./design-patterns.md#10-middleware-plugins)). Unexpected errors log the error object with `requestId`.
2. Use levels deliberately: `error` = needs a human, `warn` = degraded but handled, `info` = request/audit events, `debug` = development only.
3. Never log secrets, session tokens, passwords, full request bodies, or PII beyond ids. Log **ids**, not emails.
4. Pass context as fields (`logger.info({ userId }, 'message')`), not string concatenation.
5. SvelteKit load/render errors: implement `handleError` in `hooks.server.ts` that logs with `requestId` and returns `{ message: 'Internal error', requestId }` — never the raw error.

```ts
// src/hooks.server.ts (addition)
import type { HandleServerError } from '@sveltejs/kit'

export const handleError: HandleServerError = ({ error, event, status, message }) => {
  const errorId = crypto.randomUUID()
  logger.error({ err: error, errorId, path: event.url.pathname, status }, 'Unhandled SvelteKit error')
  return { message: status === 404 ? message : 'Internal error', errorId }
}
```

6. Ship logs to your platform's aggregator (stdout is the contract). Add error tracking (Sentry or equivalent) with the same redaction rules.

## Health and Readiness

Two endpoints **outside** `/api` (no auth, no rate limit, no business data):

```ts
// src/lib/server/shared/health.ts
import { pingDatabase } from '$lib/server/db'
import { logger } from '$lib/server/logger'

export async function checkReadiness(): Promise<boolean> {
  try {
    await pingDatabase()
    return true
  } catch (err) {
    logger.error({ err }, 'Readiness check failed')
    return false
  }
}
```

```ts
// src/routes/healthz/+server.ts — liveness: the process is up (no dependencies checked)
import { json } from '@sveltejs/kit'
export const GET = () => json({ status: 'ok' })
```

```ts
// src/routes/readyz/+server.ts — readiness: dependencies are reachable
import { json } from '@sveltejs/kit'
import { checkReadiness } from '$lib/server/shared/health'

export const GET = async () => ((await checkReadiness()) ? json({ status: 'ready' }) : json({ status: 'unavailable' }, { status: 503 }))
```

Orchestrators: liveness probe → `/healthz`, readiness probe → `/readyz`. Responses never expose versions, hostnames, or error details.

## Graceful Shutdown

adapter-node drains connections on `SIGTERM` (bounded by `SHUTDOWN_TIMEOUT`) and emits a `sveltekit:shutdown` process event. Close the pool there:

```ts
// src/hooks.server.ts (addition)
import { closeDatabase } from '$lib/server/db'
import { logger } from '$lib/server/logger'

process.on('sveltekit:shutdown', async (reason: string) => {
  logger.info({ reason }, 'Shutting down')
  await closeDatabase()
})
```

(Requires a recent `@sveltejs/adapter-node`. Verify the event name in the installed version.) The orchestrator's termination grace period must be ≥ `SHUTDOWN_TIMEOUT`.

## Security Headers and CSP

**(required)** Headers set in `hooks.server.ts` (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`) are in [auth-session.md](./auth-session.md#sveltekit-session-bridge). CSP is configured by SvelteKit so it can add nonces/hashes automatically:

```js
// svelte.config.js (excerpt)
const config = {
  kit: {
    adapter: adapter(),
    csp: {
      mode: 'auto',
      directives: {
        'default-src': ['self'],
        'script-src': ['self'],
        'style-src': ['self', 'unsafe-inline'],   // Svelte transitions/styles inject inline styles
        'img-src': ['self', 'data:'],
        'connect-src': ['self'],
        'object-src': ['none'],
        'base-uri': ['self'],
        'form-action': ['self'],
        'frame-ancestors': ['none']
      }
    }
  }
}
```

Add third-party origins (analytics, fonts, CDN) to the specific directive that needs them, one at a time. Roll out risky changes with `reportOnly` first. HSTS is only sent over HTTPS in production (terminate TLS at the proxy and keep `ORIGIN` as `https://…`).

## Proxy, Limits, and Timeouts

1. **(required)** Client IP: configure `ADDRESS_HEADER`/`XFF_DEPTH` for the exact number of trusted proxies. Wrong values allow IP spoofing (rate-limit bypass) or collapse all users into one IP.
2. **(required)** Request body limit via `BODY_SIZE_LIMIT`; per-route limits via schema `maxLength`.
3. Reverse proxy: request/idle timeouts, `Connection: keep-alive` tuned above the app's keep-alive, and gzip/brotli compression for text.
4. Outbound HTTP calls: always a timeout (`AbortSignal.timeout(ms)`) and a response size cap.
5. Database: `statement_timeout` (10 s default in the pool), `connectionTimeoutMillis`, and bounded pool size so `replicas × max` stays below the server's `max_connections`.

## Database Operations

1. **(required)** Migrations run as a **separate deploy step before** the new version starts, from `scripts/migrate.ts`; never at app boot on every replica.

```ts
// scripts/migrate.ts
import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')

const pool = new Pool({ connectionString: url, max: 1 })
try {
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' })
  console.log('Migrations applied')
} finally {
  await pool.end()
}
```

2. Migrations are **backward compatible** with the currently running version (expand → deploy → contract; [drizzle-patterns.md](./drizzle-patterns.md#migration-workflow)) so rollouts and rollbacks are safe.
3. **(required)** Automated backups with a tested restore; point-in-time recovery for production. Document RPO/RTO in the repo.
4. Expired sessions are purged by a scheduled job; other retention jobs live in `scripts/` and are idempotent.
5. Monitor slow queries (`pg_stat_statements`) and run `EXPLAIN (ANALYZE, BUFFERS)` on new hot queries before release.
6. `drizzle.config.ts` and `scripts/*` read `process.env` via `dotenv` — the documented exception to the `env.ts` rule.

## CI Pipeline

**(required)** Every pull request runs, and blocks merge on failure:

```yaml
# .github/workflows/ci.yml (excerpt)
jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: app_test }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U postgres" --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      DATABASE_URL: postgres://postgres:postgres@localhost:5432/app_test
      ORIGIN: http://localhost:5173
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - run: npm run check
      - run: npm run lint
      - run: npm run deps:cycles
      - run: npm run db:check
      - run: npm run test:unit
      - run: npm run test:integration
      - run: npm audit --omit=dev --audit-level=high
      - run: npm run build
```

Also: Dependabot/Renovate enabled; branch protection requires the `verify` job and one review; the deploy pipeline runs migrations, then rolls out, then smoke-tests `/readyz`.

## Docker and Container Compose

TESD applications ship with production-ready container configurations supporting both **Docker** (`docker compose`) and **Podman** (`podman compose` / `podman-compose`).

### 1. Multi-Stage Dockerfile

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "build"]
```

Rules:
1. Multi-stage build isolates build tooling and devDependencies from production image.
2. Runs as unprivileged `node` user (`USER node`).
3. Explicit health check against `/healthz`.
4. `.dockerignore` strictly excludes `.env*`, `node_modules`, `.git`, `.svelte-kit`, logs, and temporary caches.

### 2. Universal Container Compose (`compose.yaml`)

**Strict Rule: Zero Hardcoded Values.** Every service attribute (project name, ports, credentials, storage buckets, resource limits) reads dynamically from `.env` using `${VAR:-fallback}` syntax, guaranteeing portability between local development and production servers.

```yaml
# Supported commands:
# Docker: docker compose up -d
# Podman: podman compose up -d OR podman-compose up -d
```

Services in the compose topology:

| Service | Image | Purpose | Key Environment Variables |
|---|---|---|---|
| `app` | Local build (`Dockerfile`) | SvelteKit 3 + Elysia on Node.js | `APP_PORT`, `APP_ORIGIN`, `DATABASE_URL`, `REDIS_URL` |
| `postgres` | `postgres:17-alpine` | Primary transactional database | `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DB_PORT` |
| `redis` | `redis:7-alpine` | Cache, distributed rate limiting, queue worker | `REDIS_PORT`, `REDIS_PASSWORD` |
| `minio` | `quay.io/minio/minio` | S3-compatible object storage for file uploads | `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `MINIO_PORT_API`, `MINIO_PORT_CONSOLE` |
| `minio-init` | `docker.io/minio/mc` | Ephemeral bucket creator & policy initializer | `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` |
| `pgweb` | `sosedoff/pgweb` | Web GUI database browser for local development | `DB_PORT_WEB`, `DATABASE_URL` |

### 3. Container Management Commands

```bash
# Start all services in the background:
docker compose up -d     # or: podman-compose up -d

# View service status and health:
docker compose ps        # or: podman-compose ps

# Stream application logs:
docker compose logs -f app

# Run database migrations inside container environment:
docker compose exec app npm run db:migrate

# Stop and remove containers (preserving data volumes):
docker compose down      # or: podman-compose down
```

## Release Checklist

- [ ] CI green: check, lint, cycles, `db:check`, unit, integration, audit, build
- [ ] Migrations reviewed, backward compatible, applied before rollout
- [ ] `.env.example` matches `env.ts`; production variables set (no defaults relied upon)
- [ ] `ORIGIN` is the public `https://` origin; proxy settings (`ADDRESS_HEADER`, `XFF_DEPTH`) verified
- [ ] Health/readiness probes configured; graceful shutdown tested (`SIGTERM` during load)
- [ ] CSP and security headers verified in the browser console and a header scanner
- [ ] Rate limits verified (and Redis-backed limiter in place if more than one instance)
- [ ] Logs reach the aggregator with `requestId`; secrets are redacted; error tracking enabled
- [ ] Backups run and a restore has been rehearsed
- [ ] Rollback plan written (previous image + backward-compatible schema)
