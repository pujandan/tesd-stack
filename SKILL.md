---
name: tesd-stack
description: Coding standard for large, long-lived projects on the TESD stack (TypeScript + SvelteKit + ElysiaJS + Drizzle ORM + PostgreSQL). Use when writing, refactoring, reviewing, debugging, or scaffolding anything in a project that depends on svelte/@sveltejs/kit, elysia, drizzle-orm, or pg — features, API routes, schemas, queries, auth, tests, or deployment. Enforces English-only code, strict layering (route → service → repository → db), validated inputs, optimal queries, security by default, zero redundancy, tests, and production readiness.
---

# TESD Stack — AI Agent Coding Standard

**Stack:** TypeScript · SvelteKit (v3 / v2 LTS) · ElysiaJS (embedded in SvelteKit) · Drizzle ORM · PostgreSQL

This skill is the single source of truth for how code MUST be written in a TESD project. Every rule is mandatory unless the user explicitly overrides it for a specific project. If existing project code conflicts with this guide, follow this guide for all new code and tell the user about the conflict instead of silently copying the old pattern.

## When to Apply

Apply to any task (feature, bugfix, refactor, review, scaffolding) in a project whose `package.json` contains `@sveltejs/kit`, `elysia`, `drizzle-orm`, `pg`, or `postgres`. Apply the rules for the layers you touch: a UI-only change still follows [code-quality.md](./references/code-quality.md); an API change also follows architecture, Elysia, Drizzle, security, and testing rules.

## The Eight Non-Negotiable Principles

1. **English only & type-safe locale.** Identifiers, comments, commit messages, error messages, API payloads, docs, and branch names are English, even when the user chats in another language. User-facing copy is localized via type-safe dictionaries with a dual-locale minimum (en/xx). → [code-quality.md](./references/code-quality.md), [i18n-locale.md](./references/i18n-locale.md)
2. **Strict layering.** `route → service → repository → db`. Routes handle HTTP only. Services hold business rules and throw domain errors (no HTTP concepts, no Drizzle imports). Repositories are the ONLY code that touches Drizzle. → [architecture.md](./references/architecture.md)
3. **One boundary, one validation.** Every request body, query, param, and cookie is validated by Elysia `t` schemas before any logic runs. The Elysia API is the only entry point for UI data and mutations. → [elysia-patterns.md](./references/elysia-patterns.md)
4. **Optimal queries.** Select only needed columns, never query in loops, always paginate with `LIMIT` (max 50), index every filter+sort combination, wrap multi-write operations in a transaction. → [drizzle-patterns.md](./references/drizzle-patterns.md)
5. **Zero redundancy.** One source of truth per concept (types from Drizzle/TypeBox, enums in `$lib/shared`, error envelope in one plugin). Delete dead code. → [code-quality.md](./references/code-quality.md)
6. **Security by default.** Auth guard + ownership check in the query on every protected route, opaque DB sessions in httpOnly cookies, argon2id, parameterized SQL only, secrets only via `env.ts`, generic production errors. → [security.md](./references/security.md), [auth-session.md](./references/auth-session.md)
7. **Tested.** Services have unit tests, repositories and routes have integration tests against a real PostgreSQL, and every protected route has an authorization test. → [testing.md](./references/testing.md)
8. **Production ready.** Typed env validation, structured logs with request ids, health endpoints, security headers, rate limiting, graceful shutdown, CI gates. → [production-readiness.md](./references/production-readiness.md)

## Canonical Project Structure

```
project-root/
├── src/
│   ├── routes/
│   │   ├── api/[...slugs]/+server.ts      # The ONLY Elysia mount (catch-all)
│   │   ├── healthz/+server.ts             # Liveness (outside /api)
│   │   ├── readyz/+server.ts              # Readiness (checks the database)
│   │   └── (app)/                         # UI pages; data comes from the API
│   ├── params/uuid.ts                     # SvelteKit param matcher for [id=uuid]
│   ├── hooks.server.ts                    # Security headers + session bridge (locals.user)
│   ├── lib/
│   │   ├── shared/                        # Isomorphic: constants/enums, i18n dictionaries (en/id), pure helpers (no server imports)
│   │   ├── api/client.ts                  # Eden Treaty client factory (typed API calls)
│   │   ├── components/ui/                 # Reusable UI primitives
│   │   └── server/                        # SERVER-ONLY
│   │       ├── api/{app.ts, plugins/}     # Root Elysia app + cross-cutting plugins
│   │       ├── errors/domain-error.ts     # HTTP-free domain errors
│   │       ├── db/{index.ts, transaction.ts, errors.ts, schema/}
│   │       ├── shared/                    # Server helpers: pagination, cursor, rate-limiter
│   │       ├── utils/markdown.ts          # Plain-text stripper utility (LMS/SMS export)
│   │       ├── modules/<feature>/         # Vertical feature slice (see architecture.md)
│   │       ├── env.ts                     # Typed, boot-validated environment
│   │       └── logger.ts                  # Structured logger (pino)
│   └── app.d.ts
├── compose.yaml                           # Multi-service container compose (Docker & Podman)
├── Dockerfile                             # Multi-stage production container
├── .dockerignore
├── drizzle/                               # Generated migrations (committed)
├── drizzle.config.ts
├── scripts/migrate.ts                     # Production migration runner
└── .env.example
```

## Critical Rules at a Glance

| # | Area | Rule | Reference |
|---|---|---|---|
| 1 | Language & Locale | All code artifacts in English; dual-locale minimum (en/xx) in $lib/shared/i18n | [code-quality.md](./references/code-quality.md), [i18n-locale.md](./references/i18n-locale.md) |
| 2 | Layers | route → service → repository → db; only repositories import Drizzle | [architecture.md](./references/architecture.md) |
| 3 | Layers | Services throw `DomainError`; zero HTTP concepts in services | [architecture.md](./references/architecture.md) |
| 4 | Modules | Cross-module access only through the other module's `index.ts` | [architecture.md](./references/architecture.md) |
| 5 | Wiring | Elysia mounted once via catch-all `+server.ts`; client IP passed via `x-client-ip` | [architecture.md](./references/architecture.md) |
| 6 | Boundary | UI reads/writes go through the API (Eden + `event.fetch`); never call services from pages | [architecture.md](./references/architecture.md) |
| 7 | Validation | `t.Object` schema on body/query/params of every route; constrain every field | [elysia-patterns.md](./references/elysia-patterns.md) |
| 8 | Responses | Every route declares a `response` schema (DTO); never return raw rows | [elysia-patterns.md](./references/elysia-patterns.md) |
| 9 | Errors | Envelope `{ error: { code, message, requestId } }`; guards throw domain errors | [design-patterns.md](./references/design-patterns.md) |
| 10 | Queries | Select specific columns; no queries in loops; `LIMIT` ≤ 50 | [drizzle-patterns.md](./references/drizzle-patterns.md) |
| 11 | Queries | Keyset pagination with row-value comparison + composite index | [drizzle-patterns.md](./references/drizzle-patterns.md) |
| 12 | Schema | `precision: 3` timestamps, explicit `onDelete`, index every FK used in joins | [drizzle-patterns.md](./references/drizzle-patterns.md) |
| 13 | Migrations | `drizzle-kit generate` + migrate; never `push` outside throwaway local DBs | [drizzle-patterns.md](./references/drizzle-patterns.md) |
| 14 | Auth | Opaque session token (hash stored) in httpOnly cookie; Bearer only for external clients | [auth-session.md](./references/auth-session.md) |
| 15 | Authz | Guard flag (`requireAuth`/`requireAdmin`) AND ownership in the repository `WHERE` | [security.md](./references/security.md) |
| 16 | Injection | `sql.raw` forbidden with runtime values; escape `LIKE` input | [security.md](./references/security.md) |
| 17 | Secrets | Only via `env.ts` (`$env/dynamic/private`); `.env` gitignored | [security.md](./references/security.md) |
| 18 | TypeScript | `strict` + `noUncheckedIndexedAccess`; `any` and `as` casts on untrusted data forbidden | [code-quality.md](./references/code-quality.md) |
| 19 | Svelte | Svelte 5 runes; no legacy stores in new code | [code-quality.md](./references/code-quality.md) |
| 20 | Testing | Unit (services), integration (repositories, routes), authorization test per protected route | [testing.md](./references/testing.md) |
| 21 | Operations | Health endpoints, structured logs, security headers, CI gates | [production-readiness.md](./references/production-readiness.md) |

## AI Agent Workflow

Follow this sequence for every coding task:

1. **Detect the stack.** Read `package.json`; apply only the rules for layers that exist.
2. **Understand the module.** Open `src/lib/server/modules/<feature>/`: routes, schema, service, repository. Never create a parallel structure when a module exists. For a new feature, follow [playbooks.md](./references/playbooks.md#playbook-1-add-a-new-feature-module).
3. **Plan by layer, innermost first.** Schema/migration → repository → service → mapper/DTO → route schema + guard → tests → UI.
4. **Pick patterns.** Check [design-patterns.md](./references/design-patterns.md) before inventing structure. Reuse existing project patterns.
5. **Implement.** Copy canonical wiring exactly (catch-all mount, env module, db singleton, error plugin).
6. **Verify.** Run the commands below, then the checklist. Fix every violation; do not report fixable problems as "known issues".

## Fast Project Scaffolding

When asked to create, bootstrap, or scaffold a new TESD project (e.g. `buatkan project <name>`, `scaffold <name>`, or `/tesd-stack buatkan project ...`):

1. **Never write boilerplate files one-by-one.** Run the automated generator script directly:
   ```bash
   node <path-to-skill>/scripts/scaffold-project.js <target-directory> --name <project-name> [--port-prefix <port-prefix>]
   ```
   *(Optional `--port-prefix 7000` assigns non-conflicting local ports: APP=7000, DB=7001, REDIS=7002, MINIO=7003/7004, PGWEB=7005).*
   This creates the full canonical architecture in seconds (SvelteKit 3 / v2 LTS, Svelte 5 runes, Elysia catch-all, Drizzle singleton, zero-hardcoded container `compose.yaml` for Docker/Podman, auth session bridge, and bilingual `en`/`id` i18n dictionaries).
2. Install dependencies:
   ```bash
   cd <target-directory> && npm install
   ```
3. Start container infrastructure (or use local PostgreSQL/Redis):
   ```bash
   docker compose up -d    # or: podman-compose up -d
   ```
4. Generate and apply migrations:
   ```bash
   npm run db:generate && npm run db:migrate
   ```
5. Immediately proceed to building requested domain features using [playbooks.md](./references/playbooks.md#playbook-1-add-a-new-feature-module).

## Verification Commands

Run these before declaring a task done (add missing scripts to `package.json` per [playbooks.md](./references/playbooks.md#playbook-2-bootstrap-a-new-project)):

```bash
npm run check            # svelte-check + tsc (strict)
npm run lint             # eslint incl. architecture boundary rules
npm run test:unit        # services, mappers, pure helpers
npm run test:integration # repositories + routes against real PostgreSQL
npm run db:check         # drizzle-kit check: migration consistency
npm run deps:cycles      # madge --circular src/lib/server
```

## Pre-Completion Checklist

- [ ] All identifiers, comments, API error codes, and docs are English; UI copy localized via type-safe dictionaries (dual-locale minimum)
- [ ] No `any`; no `as` cast on untrusted data (use schemas/narrowing)
- [ ] Every route validates body/query/params/cookies and declares a `response` schema
- [ ] Every protected route has a guard flag AND the repository query is scoped by `userId`
- [ ] Only repositories import `drizzle-orm` or `$lib/server/db/schema`
- [ ] No queries in loops; list endpoints paginate with `LIMIT` ≤ 50
- [ ] Indexes exist for every new filter + sort and every FK used in joins; no redundant prefix indexes
- [ ] Multi-write operations use `withTransaction` and pass `tx` to every repository call
- [ ] Services throw domain errors; no HTTP status numbers outside plugins/routes
- [ ] No duplicated logic, dead exports, commented-out code, or unused imports
- [ ] No secrets in code; config read only through `env.ts`
- [ ] Unexpected errors are logged with `requestId` and returned as the generic envelope
- [ ] Schema changed → migration generated, read line by line, committed
- [ ] Tests added: service unit tests, repository/route integration tests, authorization (IDOR) test
- [ ] Verification commands pass

## Reference Files

Read the ones relevant to the task:

- [architecture.md](./references/architecture.md) — Layers, dependency rules, module anatomy, SvelteKit×Elysia wiring, scaling rules
- [design-patterns.md](./references/design-patterns.md) — Canonical implementations: service, repository, DTO, guard, plugins, db client, env, errors, transactions, events
- [elysia-patterns.md](./references/elysia-patterns.md) — Route standard, validation, response schemas, status codes, Eden client
- [drizzle-patterns.md](./references/drizzle-patterns.md) — Schema conventions, query optimization, pagination, transactions, migrations
- [auth-session.md](./references/auth-session.md) — Registration, login, sessions, logout, cookies, SSR bridge
- [security.md](./references/security.md) — Authorization, passwords, injection, XSS, CSRF, uploads, OWASP mapping
- [code-quality.md](./references/code-quality.md) — English rules, naming, TypeScript, Svelte 5, DRY, tooling
- [i18n-locale.md](./references/i18n-locale.md) — Multi-language flow, dual-locale minimum (en/id), type-safe dictionaries, SSR hooks, DB content
- [testing.md](./references/testing.md) — Test pyramid, tooling, templates, authorization tests
- [production-readiness.md](./references/production-readiness.md) — Config, logging, health, headers, CI/CD, Docker, migrations
- [playbooks.md](./references/playbooks.md) — Step-by-step: add a feature module, bootstrap a project, reference implementation
