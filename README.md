# TESD Stack — AI Agent Coding Standard & Architecture Guide

> **TypeScript · ElysiaJS · SvelteKit 3 / 2 (Svelte 5 Runes) · Drizzle ORM · PostgreSQL**

An opinionated, production-grade architectural standard and AI agent skill designed for building robust, scalable, and secure full-stack web applications on the **TESD stack**.

---

## ⚡ What is the TESD Stack?

The **TESD Stack** combines the speed and ergonomic elegance of modern TypeScript tooling into a unified vertical-slice architecture:

- **T — TypeScript**: `strict: true`, `noUncheckedIndexedAccess`, zero `any`, inferred data types from boundary schemas and database definitions.
- **E — ElysiaJS**: Embedded directly inside SvelteKit as a catch-all route handler (`src/routes/api/[...slugs]/+server.ts`). Provides high-speed TypeBox runtime validation, declarative guard macros, and unified error envelopes.
- **S — SvelteKit**: Modern SvelteKit 3 (and SvelteKit 2 LTS compatible) with Svelte 5 runes (`$state`, `$derived`, `$props`). The Elysia API serves as the single source of truth for both browser clients and SSR load functions via the typed **Eden Treaty** client.
- **D — Drizzle ORM**: Type-safe queries using `node-postgres`, millisecond-resolution timestamps, keyset cursor pagination with composite indexes, atomic conditional writes, and strict repository encapsulation.

---

## 🏛 The Eight Non-Negotiable Principles

1. **English Only & Type-Safe Locale**: All identifiers, comments, commit messages, API error codes, and documentation are strictly in English. UI copy and content are localized through type-safe dictionaries with a dual-locale minimum (`en`/`xx`, e.g. Indonesian `id`).
2. **Strict Layering**: `route → service → repository → db`. Routes handle HTTP only. Services hold domain rules and throw domain errors (zero HTTP concepts, zero Drizzle imports). Repositories are the only code touching Drizzle ORM.
3. **One Boundary, One Validation**: Every incoming request is validated once by Elysia TypeBox (`t`) schemas. No raw rows returned; all endpoints declare explicit response DTO schemas.
4. **Optimal Queries**: Select only required columns, never execute queries in loops (no N+1), enforce pagination with `LIMIT ≤ 50`, index every filter and sort pattern, and wrap multi-write operations in transactions.
5. **Zero Redundancy**: Single source of truth per concept (types inferred from Drizzle schemas and TypeBox, shared constants in `$lib/shared`).
6. **Security by Default**: Route guards + repository-level `WHERE userId = ?` on every protected resource, opaque database sessions with SHA-256 tokens in `httpOnly` cookies, `argon2id` password hashing, and parameterized queries only.
7. **Tested**: Unit tests for services (mocked repositories), integration tests against a real PostgreSQL instance for repositories and routes, and authorization/IDOR tests for all protected endpoints.
8. **Production Ready**: Typed environment variable validation at boot, structured JSON logging with request IDs (Pino), health endpoints (`/healthz` and `/readyz`), rate limiting, CSRF protection, security headers, and graceful shutdown.

---

## 📁 Canonical Directory Structure

```text
project-root/
├── src/
│   ├── routes/
│   │   ├── api/[...slugs]/+server.ts      # The ONLY Elysia mount (catch-all)
│   │   ├── healthz/+server.ts             # Liveness probe (outside /api)
│   │   ├── readyz/+server.ts              # Readiness probe (verifies database)
│   │   └── (app)/                         # SvelteKit UI pages (data via API)
│   ├── params/uuid.ts                     # SvelteKit UUID param matcher
│   ├── hooks.server.ts                    # Security headers + session bridge (locals.user)
│   ├── lib/
│   │   ├── shared/                        # Isomorphic constants, enums, pure helpers
│   │   ├── api/client.ts                  # Typed Eden Treaty client factory
│   │   ├── components/ui/                 # Reusable UI primitives
│   │   └── server/                        # Server-only code
│   │       ├── api/{app.ts, plugins/}     # Root Elysia instance + plugins (error, CSRF, rate-limit)
│   │       ├── errors/domain-error.ts     # HTTP-free domain errors
│   │       ├── db/{index.ts, transaction.ts, errors.ts, schema/}
│   │       ├── shared/                    # Helpers: pagination, cursor, rate-limiter
│   │       ├── modules/<feature>/         # Vertical feature slices (routes, service, repo, schema, mapper)
│   │       ├── env.ts                     # Boot-validated environment variables
│   │       └── logger.ts                  # Structured Pino logger
│   └── app.d.ts
├── compose.yaml                           # Multi-service container compose (Docker & Podman)
├── Dockerfile                             # Multi-stage production container
├── .dockerignore
├── drizzle/                               # Committed migration SQL files
├── drizzle.config.ts
├── scripts/migrate.ts                     # Production migration runner
└── .env.example
```

---

## ⚡ Instant Project Scaffolding

Generate a brand-new, production-ready TESD Stack project in seconds with the built-in CLI scaffolder:

```bash
# Generate the project (optional --port-prefix isolates ports e.g. 7000-7005):
node scripts/scaffold-project.js ./my-app --name "my-app" --port-prefix 7000

# Enter directory and install dependencies:
cd my-app
npm install

# Start container infrastructure (or use local PostgreSQL/Redis):
docker compose up -d    # or: podman-compose up -d

# Generate & run database migrations:
npm run db:generate && npm run db:migrate

# Start the dev server:
npm run dev
```

The generator instantly provisions all 60+ canonical files including:
- **SvelteKit 3 + Svelte 5**: Runes (`$state`, `$derived`, `$props`), SSR session bridge, and root layouts (SvelteKit 2 LTS compatible).
- **Embedded ElysiaJS**: Single catch-all mount at `api/[...slugs]/+server.ts` with TypeBox validation and security plugins.
- **Docker & Podman Compose**: Zero-hardcoded `compose.yaml` for PostgreSQL 17, Redis 7, MinIO S3 object storage, and pgweb UI reading all variables from `.env`.
- **Drizzle ORM & PostgreSQL**: Connection pool singleton with Vite HMR protection, millisecond timestamps, and transaction helper.
- **Ready Auth & Session**: Opaque token sessions, SHA-256 token hashing, Argon2id password hashing, and cookie management.
- **Type-Safe i18n**: Bilingual dictionary system (`en` English fallback and `id` Indonesian) with auto-detection.
- **Observability**: Structured Pino logger with secret redaction, request ID tracking, and `/healthz` + `/readyz` probes.

---

## 🤖 Installing as an AI Agent Skill

This repository is packaged as an AI Agent Skill conforming to the Agent Skills standard and Antigravity specification.

### 1. Antigravity (`agy` CLI / Antigravity IDE)
Clone or copy this folder into your workspace's skill directory:
```bash
# In your project root:
mkdir -p .agents/skills
cp -r /path/to/tesd-stack .agents/skills/tesd-stack
```

### 2. Cursor
Place a reference in `.cursorrules` or create `.cursor/rules/tesd-stack.mdc`:
```markdown
Read and apply the coding standards in `.agents/skills/tesd-stack/SKILL.md` whenever modifying SvelteKit, Elysia, Drizzle, or PostgreSQL code.
```

### 3. Claude Code
Reference `SKILL.md` inside your project's `CLAUDE.md`:
```markdown
For all backend, SvelteKit, Elysia, and Drizzle development, strictly follow the rules in `.agents/skills/tesd-stack/SKILL.md`.
```

### 4. Windsurf / Cascade
Add the path to `.windsurfrules`:
```markdown
Follow the architectural and coding standards specified in `.agents/skills/tesd-stack/SKILL.md`.
```

---

## 📚 Reference Documentation

| Document | Description |
|---|---|
| [**`SKILL.md`**](./SKILL.md) | Main agent skill entry point and critical rule summary |
| [**`architecture.md`**](./references/architecture.md) | Layer model, dependency boundaries, module anatomy, ESLint rules |
| [**`design-patterns.md`**](./references/design-patterns.md) | Canonical implementations for services, repos, guards, errors, db singleton, rate limiting |
| [**`elysia-patterns.md`**](./references/elysia-patterns.md) | Route standards, TypeBox validation, response DTOs, Eden Treaty client |
| [**`drizzle-patterns.md`**](./references/drizzle-patterns.md) | Schema design, keyset cursor pagination, query optimization, migrations |
| [**`auth-session.md`**](./references/auth-session.md) | Opaque session tokens, cookies, login/register flows, SvelteKit SSR session bridge |
| [**`security.md`**](./references/security.md) | Authorization, IDOR prevention, password hashing (argon2id), SQL injection, CSRF |
| [**`code-quality.md`**](./references/code-quality.md) | English-only rules, TypeScript strictness, Svelte 5 runes, naming conventions |
| [**`i18n-locale.md`**](./references/i18n-locale.md) | Multi-language flow, dual-locale minimum (en/id), type-safe dictionaries, SSR hooks, DB content |
| [**`testing.md`**](./references/testing.md) | Test pyramid, Vitest setup, real PostgreSQL integration tests, IDOR tests |
| [**`production-readiness.md`**](./references/production-readiness.md) | Env validation, structured logging, health checks, security headers, Docker, CI |
| [**`playbooks.md`**](./references/playbooks.md) | Step-by-step recipes: add a feature module, bootstrap a project, complete reference implementation |

---

## 🛠 Verifying Skill Integrity

To audit all markdown links, heading anchors, and frontmatter definitions within this repository:

```bash
python3 scripts/audit.py
```

---

## 👨‍💻 Author

<a href="https://github.com/pujandan">
  <img src="https://github.com/pujandan.png" width="80" height="80" alt="Pujan (@pujandan)" style="border-radius: 50%;" />
</a>

**Pujan** ([@pujandan](https://github.com/pujandan))

---

## 📄 License

[MIT](./LICENSE) © 2026 [Pujan](https://github.com/pujandan)

