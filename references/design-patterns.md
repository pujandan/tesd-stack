# Design Patterns — Canonical Implementations for the TESD Stack

This file is the **single home** of infrastructure code (plugins, db client, env, errors). Other files link here instead of repeating it. Apply a pattern only when its **When** condition is met; defaults come from [architecture.md](./architecture.md).

> Verify Elysia-specific signatures (`macro`, `derive`, `onAfterResponse`) against the installed Elysia version with `npm run check` — they evolve between minor releases.

## Contents

1. [Service Layer](#1-service-layer)
2. [Repository](#2-repository)
3. [DTO & Mapper](#3-dto--mapper)
4. [Guard / Policy (Elysia macro)](#4-guard--policy)
5. [Plugin Composition](#5-plugin-composition)
6. [Singleton (DB client) + Transaction helper](#6-singleton-db-client--transaction-helper)
7. [Environment Adapter](#7-environment-adapter)
8. [Domain Errors & Error Envelope](#8-domain-errors--error-envelope)
9. [Unit of Work (Transaction)](#9-unit-of-work-transaction)
10. [Middleware Plugins (request context, CSRF, rate limit)](#10-middleware-plugins)
11. [Factory (cursor & pagination)](#11-factory-cursor--pagination)
12. [Event-Driven Side Effects](#12-event-driven-side-effects)
13. [Pattern Selection Cheat Sheet](#pattern-selection-cheat-sheet)

---

## 1. Service Layer

**When:** every feature, always.

**Purpose:** business rules independent of HTTP and SQL. Callable from a route, a script, or a job without change.

```ts
// post.service.ts
import { NotFoundError } from '$lib/server/errors/domain-error'
import { DEFAULT_PAGE_SIZE } from '$lib/shared/constants/pagination'
import { parseCursor } from '$lib/server/shared/cursor'
import { toPage } from '$lib/server/shared/pagination'
import { postRepository } from './post.repository'
import { toPostDetailDto, toPostSummaryDto } from './post.mapper'
import type { CreatePostBody, ListPostsQuery, PostDetailDto, PostPageDto } from './post.schema'

export const postService = {
  async getById(userId: string, postId: string): Promise<PostDetailDto> {
    const row = await postRepository.findByIdForUser(userId, postId)
    if (!row) throw new NotFoundError('Post not found')
    return toPostDetailDto(row)
  }
  // ...see playbooks.md for the full module
}
```

**Rules:**
- Export a plain object `<feature>Service` with verb-named methods (`getById`, `listByUser`, `create`, `archive`).
- Never import `drizzle-orm`, schema tables, or HTTP types. Throw `DomainError` subclasses.
- Every method acting on a user-owned resource takes `userId` as the **first** argument and passes it to a repository method that filters by owner in SQL.
- Pick fields explicitly when passing input to a repository (`{ title: input.title }`), never spread `body`.

---

## 2. Repository

**When:** every feature. It is the only layer that imports Drizzle (see [architecture.md](./architecture.md#dependency-rules)).

**Purpose:** all SQL for one aggregate in one file; reusable and swappable; mockable in service tests.

```ts
// post.repository.ts
import { and, desc, eq, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '$lib/server/db'
import { posts } from '$lib/server/db/schema'
import type { Cursor } from '$lib/server/shared/cursor'

export type PostRow = typeof posts.$inferSelect
export type NewPostValues = Pick<typeof posts.$inferInsert, 'title' | 'content' | 'status'>

const SUMMARY_COLUMNS = { id: posts.id, title: posts.title, status: posts.status, createdAt: posts.createdAt } as const

export const postRepository = {
  /** Returns up to `limit + 1` rows; the extra row signals that a next page exists. */
  findPageByUser(userId: string, page: { limit: number; cursor: Cursor | null }, executor: DbExecutor = db) {
    return executor
      .select(SUMMARY_COLUMNS)
      .from(posts)
      .where(and(
        eq(posts.userId, userId),
        page.cursor
          ? sql`(${posts.createdAt}, ${posts.id}) < (${page.cursor.createdAt.toISOString()}::timestamptz, ${page.cursor.id}::uuid)`
          : undefined
      ))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(page.limit + 1)
  },

  async findByIdForUser(userId: string, postId: string, executor: DbExecutor = db): Promise<PostRow | undefined> {
    const [row] = await executor.select().from(posts)
      .where(and(eq(posts.id, postId), eq(posts.userId, userId)))
      .limit(1)
    return row
  }
}
```

**Rules:**
- Return rows or row shapes. Do **not** map DTOs, throw domain errors, or read HTTP state.
- **Ownership is part of the method name and SQL:** `findByIdForUser`, `updateForUser`, `deleteForUser`. A repository method that takes only `id` for a user-owned table is a defect.
- Every method takes `executor: DbExecutor = db` as its **last** parameter so it can join a transaction.
- Build optional filters with a `conditions: SQL[]` array and `and(...conditions)`; never string concatenation or nested ternaries.
- Prefer atomic SQL (`onConflictDoNothing`, `UPDATE … WHERE … RETURNING`) over read-then-write.

---

## 3. DTO & Mapper

**When:** always for responses. The response shape is a contract and must not be a raw row.

```ts
// post.schema.ts (excerpt) — TypeBox is the source of truth for both validation and the TS type
export const postSummaryDtoSchema = t.Object({
  id: t.String(),
  title: t.String(),
  status: postStatusSchema,
  createdAt: t.String()
})
export type PostSummaryDto = typeof postSummaryDtoSchema.static
```

```ts
// post.mapper.ts — the ONLY place row → DTO happens
import type { PostRow } from './post.repository'
import type { PostSummaryDto } from './post.schema'

export function toPostSummaryDto(row: Pick<PostRow, 'id' | 'title' | 'status' | 'createdAt'>): PostSummaryDto {
  return { id: row.id, title: row.title, status: row.status, createdAt: row.createdAt.toISOString() }
}
```

**Rules:**
- Every route declares `response: { 200: <dtoSchema> }`: Elysia validates and strips undeclared fields, a second line of defense against leaking columns.
- Sensitive columns (`passwordHash`, `tokenHash`, internal notes) are never selected outside the repository method that needs them.
- `Date → ISO string` conversion happens in the mapper, once.

---

## 4. Guard / Policy

**When:** any route requiring authentication or a role. Implemented as Elysia **macros** so protection is a route flag, not copied code. Full session logic: [auth-session.md](./auth-session.md).

```ts
// src/lib/server/modules/session/session.plugin.ts
import { Elysia } from 'elysia'
import { ForbiddenError, UnauthorizedError } from '$lib/server/errors/domain-error'
import { sessionService } from './session.service'
import { SESSION_COOKIE_NAME } from './session.cookie'
import type { AuthUser } from './session.types'

function readBearerToken(authorization: string | undefined): string | undefined {
  return authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
}

async function authenticateRequest(cookieValue: unknown, authorization: string | undefined): Promise<AuthUser> {
  const token = typeof cookieValue === 'string' ? cookieValue : readBearerToken(authorization)
  const user = token ? await sessionService.authenticate(token) : null
  if (!user) throw new UnauthorizedError()
  return user
}

export const authPlugin = new Elysia({ name: 'auth' }).macro({
  requireAuth: {
    async resolve({ cookie, headers }) {
      // Returning { user } makes `user` non-optional in the handler type.
      return { user: await authenticateRequest(cookie[SESSION_COOKIE_NAME]?.value, headers.authorization) }
    }
  },
  requireAdmin: {
    async resolve({ cookie, headers }) {
      const user = await authenticateRequest(cookie[SESSION_COOKIE_NAME]?.value, headers.authorization)
      if (user.role !== 'admin') throw new ForbiddenError()
      return { user }
    }
  }
})
```

```ts
.get('/', ({ user, query }) => postService.listByUser(user.id, query), { requireAuth: true, ... })
.post('/export', ({ user }) => adminService.export(user.id), { requireAdmin: true, ... })
```

**Rules:**
- Guards **throw domain errors**; the error plugin builds the envelope (no hand-written `error(401, {...})` objects).
- A route has exactly one guard flag. `requireAdmin` implies authentication.
- The role comes from the session lookup (database), never from the client.
- Guard = "who may call this endpoint". "Whose data" = repository `WHERE userId = ?`. Both are mandatory.
- Need another role? Add another macro (`requireModerator`) that reuses `authenticateRequest`; do not add stringly-typed role parameters.

---

## 5. Plugin Composition

**When:** always. Everything in Elysia is a named, composable plugin.

```ts
export const postRoutes = new Elysia({ name: 'post-routes', prefix: '/posts' })
  .use(authPlugin)          // guards/limiters first…
  .get('/', handler, opts)  // …then routes (hooks only affect later routes)
```

**Rules:**
- Every plugin has a unique `name` and, for feature plugins, a `prefix` equal to the resource (`/posts`).
- Registration order in `app.ts`: request context → error → CSRF → global rate limit → feature routes.
- Cross-cutting plugins live in `src/lib/server/api/plugins/`; feature plugins live in the module.

---

## 6. Singleton (DB client) + Transaction helper

**When:** once per application.

```ts
// src/lib/server/db/index.ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { env } from '$lib/server/env'
import { logger } from '$lib/server/logger'
import * as schema from './schema'

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined
}

function createPool(): Pool {
  const created = new Pool({
    connectionString: env.DATABASE_URL,      // add ?sslmode=require for managed databases
    max: env.IS_PROD ? 20 : 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000                // protect the pool from runaway queries
  })
  // Without this handler an error on an idle client crashes the Node process.
  created.on('error', (err) => logger.error({ err }, 'Unexpected PostgreSQL pool error'))
  return created
}

// Preserve the pool across Vite HMR reloads in development.
const pool = globalThis.__pgPool ?? createPool()
if (!env.IS_PROD) globalThis.__pgPool = pool

export const db = drizzle(pool, { schema })

export type Database = typeof db
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
export type DbExecutor = Database | Transaction

export const closeDatabase = () => pool.end()
export const pingDatabase = async () => { await pool.query('select 1') }
```

```ts
// src/lib/server/db/transaction.ts — the only db import services are allowed to use
import { db, type Transaction } from './index'

export type { Transaction }

export function withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(work)
}
```

**Rules:**
- Never `new Pool()` inside a function, handler, or loop.
- All modules share the same `db`. Only repositories import it; services use `withTransaction`.

---

## 7. Environment Adapter

**When:** once per project at scaffold time.

**Why `$env/dynamic/private`:** Vite loads `.env` into SvelteKit's `$env` modules, not into `process.env`, so reading `process.env` fails in dev. The module also must not throw during `vite build` analysis, when runtime variables do not exist.

```ts
// src/lib/server/env.ts
import { env as raw } from '$env/dynamic/private'
import { building, dev } from '$app/environment'

function required(name: string): string {
  const value = raw[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function loadEnv() {
  return {
    DATABASE_URL: required('DATABASE_URL'),
    ORIGIN: required('ORIGIN'),                         // public origin, e.g. https://app.example.com
    LOG_LEVEL: raw.LOG_LEVEL ?? (dev ? 'debug' : 'info'),
    IS_PROD: !dev
  } as const
}

export type Env = ReturnType<typeof loadEnv>

// During `vite build` the runtime variables are absent; skip validation then.
export const env: Env = building
  ? { DATABASE_URL: '', ORIGIN: '', LOG_LEVEL: 'info', IS_PROD: true }
  : loadEnv()
```

**Rules:**
- No module reads `$env/*` or `process.env` except `env.ts`. Exceptions: `drizzle.config.ts`, `scripts/*`, and test setup (they run outside SvelteKit; use `import 'dotenv/config'`).
- Any secret added later (e.g. webhook signing key) is validated here with a minimum length (≥ 32 random bytes) — fail at boot, not on the first request.
- Commit `.env.example` with every variable and placeholder values; `.env` is gitignored.

---

## 8. Domain Errors & Error Envelope

**When:** every error, project-wide.

```ts
// src/lib/server/errors/domain-error.ts — independent of HTTP
export type DomainErrorCode =
  | 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND'
  | 'CONFLICT' | 'VALIDATION_ERROR' | 'RATE_LIMITED'

export class DomainError extends Error {
  constructor(public readonly code: DomainErrorCode, message: string) {
    super(message)
    this.name = new.target.name
  }
}

export class BadRequestError extends DomainError {
  constructor(message = 'Invalid request') { super('BAD_REQUEST', message) }
}
export class UnauthorizedError extends DomainError {
  constructor(message = 'Authentication required') { super('UNAUTHORIZED', message) }
}
export class ForbiddenError extends DomainError {
  constructor(message = 'Insufficient permissions') { super('FORBIDDEN', message) }
}
export class NotFoundError extends DomainError {
  constructor(message = 'Resource not found') { super('NOT_FOUND', message) }
}
export class ConflictError extends DomainError {
  constructor(message = 'Resource already exists') { super('CONFLICT', message) }
}
export class TooManyRequestsError extends DomainError {
  constructor(public readonly retryAfterSeconds?: number, message = 'Too many requests') {
    super('RATE_LIMITED', message)
  }
}
```

```ts
// src/lib/server/api/plugins/error.plugin.ts
import { Elysia } from 'elysia'
import { DomainError, TooManyRequestsError, type DomainErrorCode } from '$lib/server/errors/domain-error'
import { logger } from '$lib/server/logger'
import { requestContextPlugin } from './request-context.plugin'

const STATUS_BY_CODE = {
  BAD_REQUEST: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404,
  CONFLICT: 409, VALIDATION_ERROR: 422, RATE_LIMITED: 429
} as const satisfies Record<DomainErrorCode, number>

function envelope(code: string, message: string, requestId: string, fields?: string[]) {
  return { error: { code, message, requestId, ...(fields ? { fields } : {}) } }
}

export const errorPlugin = new Elysia({ name: 'error' })
  .use(requestContextPlugin)
  .onError({ as: 'global' }, ({ code, error: err, set, requestId }) => {
    if (err instanceof DomainError) {
      set.status = STATUS_BY_CODE[err.code]
      if (err instanceof TooManyRequestsError && err.retryAfterSeconds) {
        set.headers['retry-after'] = String(err.retryAfterSeconds)
      }
      return envelope(err.code, err.message, requestId)
    }
    switch (code) {
      case 'VALIDATION':
        set.status = 422
        // Only field paths are returned; never echo the submitted values.
        return envelope('VALIDATION_ERROR', 'Request validation failed', requestId, err.all.map((issue) => issue.path))
      case 'PARSE':
        set.status = 400
        return envelope('BAD_REQUEST', 'Malformed request body', requestId)
      case 'NOT_FOUND':
        set.status = 404
        return envelope('NOT_FOUND', 'Route not found', requestId)
    }
    // Unexpected: log everything server-side, return nothing internal.
    logger.error({ err, requestId }, 'Unhandled API error')
    set.status = 500
    return envelope('INTERNAL', 'Internal server error', requestId)
  })
```

**Rules:**
- Error `code` is SCREAMING_SNAKE_CASE from the fixed vocabulary above. Add a code here first, then use it.
- Services and guards **throw**; they never return `error(...)` objects. There is no second place that builds an envelope.
- The 500 branch never returns `err.message`, SQL, paths, or stack traces.
- 4xx domain errors are expected outcomes and are not logged at `error` level.

---

## 9. Unit of Work (Transaction)

**When:** any operation writing to more than one table, or writing then reading dependently.

```ts
// order.service.ts — the service orchestrates, repositories execute
import { withTransaction } from '$lib/server/db/transaction'

async placeOrder(userId: string, input: PlaceOrderBody) {
  return withTransaction(async (tx) => {
    const order = await orderRepository.insert(userId, input, tx)
    const reserved = await productRepository.reserveStock(input.items, tx)   // returns false if stock is insufficient
    if (!reserved) throw new ConflictError('Insufficient stock')            // rolls everything back
    await orderRepository.insertEvent(order.id, 'PLACED', tx)
    return order.id
  })
}
```

**Rules:**
- Pass `tx` as the last argument to **every** repository call inside the callback. A call without `tx` silently escapes the transaction.
- Keep transactions short: database work only. No HTTP calls, emails, or event emits inside (see [§12](#12-event-driven-side-effects)).
- Throwing rolls back. Never catch and swallow errors to "keep the transaction alive".

---

## 10. Middleware Plugins

**When:** concerns that apply to many routes: request identity/logging, CSRF, rate limiting.

### Request context (request id, client IP, access log)

```ts
// src/lib/server/api/plugins/request-context.plugin.ts
import { Elysia } from 'elysia'
import { logger } from '$lib/server/logger'

export const requestContextPlugin = new Elysia({ name: 'request-context' })
  .derive({ as: 'global' }, ({ request, set }) => {
    // Always generate: trusting a client-supplied id enables log injection.
    const requestId = crypto.randomUUID()
    set.headers['x-request-id'] = requestId
    return {
      requestId,
      startedAt: performance.now(),
      clientIp: request.headers.get('x-client-ip') ?? 'unknown'   // set by the catch-all, never by clients
    }
  })
  .onAfterResponse({ as: 'global' }, ({ request, set, requestId, startedAt }) => {
    logger.info({
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      status: Number(set.status ?? 200),
      durationMs: Math.round(performance.now() - startedAt)
    }, 'request completed')
  })
```

### CSRF (cookie-authenticated requests)

```ts
// src/lib/server/api/plugins/csrf.plugin.ts
import { Elysia } from 'elysia'
import { env } from '$lib/server/env'
import { ForbiddenError } from '$lib/server/errors/domain-error'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export const csrfPlugin = new Elysia({ name: 'csrf' }).onBeforeHandle({ as: 'global' }, ({ request }) => {
  if (SAFE_METHODS.has(request.method)) return
  if (request.headers.has('authorization')) return            // Bearer clients carry no ambient credentials
  const origin = request.headers.get('origin')
  if (origin !== null) {
    if (origin !== env.ORIGIN) throw new ForbiddenError('Cross-origin request rejected')
    return
  }
  if (request.headers.has('cookie')) throw new ForbiddenError('Missing Origin header')
})
```

### Rate limiting

```ts
// src/lib/server/shared/rate-limiter.ts
export interface RateLimitResult { allowed: boolean; retryAfterSeconds: number }
export interface RateLimiter {
  consume(key: string): Promise<RateLimitResult>
  reset(key: string): Promise<void>
}

/** In-memory fixed window. For multiple instances, implement RateLimiter on Redis; callers do not change. */
export function createRateLimiter(options: { windowMs: number; max: number }): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>()
  setInterval(() => {
    const now = Date.now()
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key)
  }, options.windowMs).unref()

  return {
    async consume(key) {
      const now = Date.now()
      const existing = buckets.get(key)
      const bucket = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + options.windowMs }
      bucket.count += 1
      buckets.set(key, bucket)
      return { allowed: bucket.count <= options.max, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) }
    },
    async reset(key) { buckets.delete(key) }
  }
}
```

```ts
// src/lib/server/api/plugins/rate-limit.plugin.ts
import { Elysia } from 'elysia'
import { TooManyRequestsError } from '$lib/server/errors/domain-error'
import { createRateLimiter } from '$lib/server/shared/rate-limiter'
import { requestContextPlugin } from './request-context.plugin'

export function rateLimitPlugin(options: { name: string; windowMs: number; max: number }) {
  const limiter = createRateLimiter(options)
  return new Elysia({ name: `rate-limit:${options.name}` })
    .use(requestContextPlugin)
    .onBeforeHandle({ as: 'scoped' }, async ({ clientIp }) => {
      const result = await limiter.consume(clientIp)
      if (!result.allowed) throw new TooManyRequestsError(result.retryAfterSeconds)
    })
}
```

Use a strict instance on credential endpoints: `.use(rateLimitPlugin({ name: 'auth', windowMs: 15 * 60_000, max: 20 }))` at the top of `authRoutes`.

**Rules:**
- Middleware contains no business logic. A hook that knows about posts belongs in the post module.
- Order of `.use()` = order of execution. Context and errors first.
- Limits are numbers, not adjectives: global 300 requests/min/IP; credential endpoints 20 per 15 min/IP; tune per product.

---

## 11. Factory (cursor & pagination)

**When:** logic that must have exactly one definition: cursor encoding, page trimming.

```ts
// src/lib/server/shared/cursor.ts
import { BadRequestError } from '$lib/server/errors/domain-error'

export interface Cursor { createdAt: Date; id: string }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function encodeCursor(row: Cursor): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url')
}

/** Returns null when no cursor was sent; throws BadRequestError when the cursor is malformed. */
export function parseCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null
  const [iso, id, ...rest] = Buffer.from(raw, 'base64url').toString('utf8').split('|')
  const createdAt = new Date(iso ?? '')
  if (rest.length > 0 || Number.isNaN(createdAt.getTime()) || !id || !UUID_PATTERN.test(id)) {
    throw new BadRequestError('Invalid cursor')
  }
  return { createdAt, id }
}
```

```ts
// src/lib/server/shared/pagination.ts
import { t } from 'elysia'
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '$lib/shared/constants/pagination'
import { encodeCursor, type Cursor } from './cursor'

export const paginationQuerySchema = t.Object({
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE })),
  cursor: t.Optional(t.String({ maxLength: 200 }))
}, { additionalProperties: false })

/** Trims the probe row (`limit + 1` rows were fetched) and builds the next cursor from raw rows. */
export function toPage<T extends Cursor>(rows: T[], limit: number): { items: T[]; nextCursor: string | null } {
  const hasNext = rows.length > limit
  const items = hasNext ? rows.slice(0, limit) : rows
  const last = items.at(-1)
  return { items, nextCursor: hasNext && last ? encodeCursor(last) : null }
}
```

**Rules:**
- A factory owns all validation of what it builds. Malformed user input → `BadRequestError`, never a database error or a 500.
- The cursor is not secret: it only encodes sort keys, and every query still scopes by `userId`.
- If the same literal or computation appears in 3+ places, promote it to a factory.

---

## 12. Event-Driven Side Effects

**When:** the caller must not wait for an effect (email, cache purge, webhook) and the effect must not run inside a transaction. Keep it light: an in-process bus.

```ts
// src/lib/server/events/bus.ts
import { logger } from '$lib/server/logger'

type EventMap = {
  'user.registered': { userId: string; email: string }
  'post.published': { postId: string; userId: string }
}
type Handler<K extends keyof EventMap> = (payload: EventMap[K]) => Promise<void> | void

const handlers = new Map<keyof EventMap, Array<(payload: never) => unknown>>()

export const eventBus = {
  on<K extends keyof EventMap>(event: K, handler: Handler<K>): void {
    handlers.set(event, [...(handlers.get(event) ?? []), handler])
  },
  /** Fire-and-forget: never blocks or fails the caller. Handler failures are logged. */
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    for (const handler of handlers.get(event) ?? []) {
      // The cast is safe: `on` only stores handlers whose payload type matches `event`.
      Promise.resolve()
        .then(() => (handler as Handler<K>)(payload))
        .catch((err: unknown) => logger.error({ err, event }, 'Event handler failed'))
    }
  }
}
```

**Rules:**
- Emit only **after** the transaction commits.
- The bus is not durable: events are lost on crash. If an effect must not be lost (payments, billing, audit trail), write an **outbox row in the same transaction** and process it with a worker; do not use the bus.
- Register handlers once at startup (`init` hook), never inside request handlers.

---

## Pattern Selection Cheat Sheet

| Situation | Pattern(s) |
|---|---|
| Any feature | Service + Repository + DTO/Mapper + Plugin Composition |
| Route needs login/role | Guard macros |
| Multiple writes must be atomic | Unit of Work (`withTransaction`, pass `tx`) |
| Config/secrets | Environment Adapter |
| Cross-cutting concern | Middleware plugin |
| Pagination | Cursor factory + `toPage` |
| Post-commit side effect | Event bus (or outbox when it must not be lost) |
