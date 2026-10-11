# Auth & Sessions — Registration, Login, Cookies, SSR Bridge

**Decision (project-wide default):** opaque, server-side **sessions** stored in PostgreSQL, delivered in an **httpOnly cookie**. This replaces JWT for first-party web apps: sessions are instantly revocable (logout, password change), have one verification path, need no signing secret, and avoid JWT pitfalls (stale roles, no revocation, refresh-token plumbing).

Non-browser clients may send the same session token as `Authorization: Bearer <token>`. If such clients are required, add an explicit, rate-limited `POST /auth/token` endpoint that returns the token in the body; the cookie flow never returns the token in a body.

## Contents

- [Module Split](#module-split)
- [Data Model](#data-model)
- [Token and Cookie Rules](#token-and-cookie-rules)
- [Session Module](#session-module)
- [Auth Module](#auth-module)
- [SvelteKit Session Bridge](#sveltekit-session-bridge)
- [Operational Rules](#operational-rules)

## Module Split

Authentication is split into two modules so the module graph stays acyclic ([architecture.md](./architecture.md#module-boundaries)):

```
modules/session/   # sessions table, token lifecycle, guards (authPlugin macros). Depends on: db only.
modules/auth/      # register / login / logout routes, password hashing, login throttling.
                   # Depends on: user (service), session (service).
modules/user/      # users table, profile. Routes use session's authPlugin.   Depends on: session.
modules/post/ …    # any feature: depends on session for guards.
```

`session` never imports `user`/`auth`; it reads the user's role with a **read-only join** in its repository. Dependency direction: `feature → session`, `auth → user → session`, `auth → session`.

## Data Model

```ts
// src/lib/server/db/schema/session.ts
import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { timestampColumn } from './_columns'
import { users } from './user'

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),          // SHA-256 of the token; the token itself is never stored
  expiresAt: timestampColumn('expires_at').notNull(),
  createdAt: timestampColumn('created_at').notNull().defaultNow()
}, (table) => [
  index('sessions_user_id_idx').on(table.userId),            // logout-everywhere + cascade deletes
  index('sessions_expires_at_idx').on(table.expiresAt)       // expired-session cleanup
])
```

## Token and Cookie Rules

1. **Token:** 32 random bytes (`randomBytes(32).toString('base64url')`). Store only `sha256(token)` (hex). High-entropy tokens do not need a slow hash.
2. **Lifetime:** absolute 14 days (`SESSION_TTL_MS`). For sliding sessions, renew only in the session bridge and re-set the cookie there.
3. **Cookie:** name `session`, `httpOnly: true`, `secure: env.IS_PROD`, `sameSite: 'lax'`, `path: '/'`, explicit `expires`, **no `Domain`** (host-only).
4. Never put the token in `localStorage`, URLs, logs, or response bodies of the cookie flow.
5. **Revocation:** logout deletes the row; password change and "logout everywhere" delete all of the user's rows.
6. Expired rows are removed by a scheduled job calling `sessionRepository.deleteExpired()` (daily).

## Session Module

```ts
// modules/session/session.types.ts
import type { Role } from '$lib/shared/constants/roles'
export interface AuthUser { id: string; role: Role }
```

```ts
// modules/session/session.cookie.ts
import { env } from '$lib/server/env'

export const SESSION_COOKIE_NAME = 'session'
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000

export function sessionCookieOptions(expiresAt: Date) {
  return { httpOnly: true, secure: env.IS_PROD, sameSite: 'lax', path: '/', expires: expiresAt } as const
}
```

```ts
// modules/session/session.repository.ts
import { and, eq, gt, lt } from 'drizzle-orm'
import { db, type DbExecutor } from '$lib/server/db'
import { sessions, users } from '$lib/server/db/schema'

export const sessionRepository = {
  async insert(values: { userId: string; tokenHash: string; expiresAt: Date }, executor: DbExecutor = db) {
    await executor.insert(sessions).values(values)
  },
  async findActiveUserByTokenHash(tokenHash: string, executor: DbExecutor = db) {
    const [row] = await executor
      .select({ userId: users.id, role: users.role })      // read-only cross-module join: allowed in a repository
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
      .limit(1)
    return row
  },
  async deleteByTokenHash(tokenHash: string, executor: DbExecutor = db) {
    await executor.delete(sessions).where(eq(sessions.tokenHash, tokenHash))
  },
  async deleteAllForUser(userId: string, executor: DbExecutor = db) {
    await executor.delete(sessions).where(eq(sessions.userId, userId))
  },
  async deleteExpired(executor: DbExecutor = db) {
    await executor.delete(sessions).where(lt(sessions.expiresAt, new Date()))
  }
}
```

```ts
// modules/session/session.service.ts
import { createHash, randomBytes } from 'node:crypto'
import { SESSION_TTL_MS } from './session.cookie'
import { sessionRepository } from './session.repository'
import type { AuthUser } from './session.types'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export const sessionService = {
  async create(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
    await sessionRepository.insert({ userId, tokenHash: hashToken(token), expiresAt })
    return { token, expiresAt }
  },

  /** Returns the authenticated user, or null. Never throws for an unknown or expired token. */
  async authenticate(token: string): Promise<AuthUser | null> {
    const row = await sessionRepository.findActiveUserByTokenHash(hashToken(token))
    return row ? { id: row.userId, role: row.role } : null
  },

  revoke: (token: string) => sessionRepository.deleteByTokenHash(hashToken(token)),
  revokeAllForUser: (userId: string) => sessionRepository.deleteAllForUser(userId)
}
```

The guard macros (`requireAuth`, `requireAdmin`) are implemented in `modules/session/session.plugin.ts`, exported as `authPlugin` ([design-patterns.md §4](./design-patterns.md#4-guard--policy); it calls `sessionService.authenticate`). The module `index.ts` exports: `authPlugin`, `sessionService`, `SESSION_COOKIE_NAME`, `sessionCookieOptions`, `type AuthUser`.

## Auth Module

```ts
// modules/auth/auth.service.ts
import { hash, verify } from '@node-rs/argon2'
import { TooManyRequestsError, UnauthorizedError } from '$lib/server/errors/domain-error'
import { createRateLimiter } from '$lib/server/shared/rate-limiter'
import { sessionService } from '$lib/server/modules/session'
import { userService } from '$lib/server/modules/user'
import type { LoginBody, RegisterBody } from './auth.schema'

// Explicit parameters (OWASP minimum for argon2id: m=19 MiB, t=2, p=1). Never rely on library defaults.
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const

// A REAL hash computed once, so an unknown-email login costs the same CPU as a wrong-password login.
let dummyHash: Promise<string> | undefined
const getDummyHash = () => (dummyHash ??= hash('timing-equalizer', ARGON2_OPTIONS))

const loginLimiter = createRateLimiter({ windowMs: 15 * 60_000, max: 10 })   // per account (email)

const normalizeEmail = (email: string) => email.trim().toLowerCase()

export const authService = {
  async register(input: RegisterBody) {
    const passwordHash = await hash(input.password, ARGON2_OPTIONS)
    // userService.create throws ConflictError atomically (onConflictDoNothing): no select-then-insert race.
    // Trade-off: a 409 reveals that an email exists. For high-sensitivity apps use an email-verification flow.
    const user = await userService.create({ email: normalizeEmail(input.email), name: input.name, passwordHash })
    return { user, ...(await sessionService.create(user.id)) }
  },

  async login(input: LoginBody) {
    const email = normalizeEmail(input.email)
    const attempt = await loginLimiter.consume(email)
    if (!attempt.allowed) throw new TooManyRequestsError(attempt.retryAfterSeconds)

    const credentials = await userService.findCredentialsByEmail(email)
    // Always run verify(), even for unknown emails, to equalize timing.
    const isValid = await verify(credentials?.passwordHash ?? (await getDummyHash()), input.password)
    if (!credentials || !isValid) throw new UnauthorizedError('Invalid email or password')

    await loginLimiter.reset(email)
    return { user: await userService.getById(credentials.id), ...(await sessionService.create(credentials.id)) }
  },

  logout: (token: string) => sessionService.revoke(token),

  async changePassword(userId: string, newPassword: string) {
    await userService.updatePasswordHash(userId, await hash(newPassword, ARGON2_OPTIONS))
    await sessionService.revokeAllForUser(userId)          // invalidate every existing session
    return sessionService.create(userId)
  }
}
```

```ts
// modules/auth/auth.routes.ts
import { Elysia, t } from 'elysia'
import { rateLimitPlugin } from '$lib/server/api/plugins/rate-limit.plugin'
import { authPlugin, SESSION_COOKIE_NAME, sessionCookieOptions } from '$lib/server/modules/session'
import { userDtoSchema, userService } from '$lib/server/modules/user'
import { authService } from './auth.service'
import { loginBodySchema, registerBodySchema } from './auth.schema'

const sessionCookieSchema = t.Cookie({ [SESSION_COOKIE_NAME]: t.Optional(t.String()) })

export const authRoutes = new Elysia({ name: 'auth-routes', prefix: '/auth' })
  .use(rateLimitPlugin({ name: 'auth', windowMs: 15 * 60_000, max: 20 }))   // strict, per IP
  .use(authPlugin)
  .post('/register', async ({ body, cookie, set }) => {
    const { user, token, expiresAt } = await authService.register(body)
    cookie[SESSION_COOKIE_NAME]?.set({ value: token, ...sessionCookieOptions(expiresAt) })
    set.status = 201
    return user
  }, { body: registerBodySchema, cookie: sessionCookieSchema, response: { 201: userDtoSchema } })
  .post('/login', async ({ body, cookie }) => {
    const { user, token, expiresAt } = await authService.login(body)
    cookie[SESSION_COOKIE_NAME]?.set({ value: token, ...sessionCookieOptions(expiresAt) })
    return user
  }, { body: loginBodySchema, cookie: sessionCookieSchema, response: { 200: userDtoSchema } })
  .post('/logout', async ({ cookie, set }) => {
    const sessionCookie = cookie[SESSION_COOKIE_NAME]
    if (typeof sessionCookie?.value === 'string') await authService.logout(sessionCookie.value)
    sessionCookie?.remove()
    set.status = 204
  }, { cookie: sessionCookieSchema, response: { 204: t.Void() } })
  .get('/me', ({ user }) => userService.getById(user.id), {
    requireAuth: true,
    response: { 200: userDtoSchema }
  })
```

Cookie handling is HTTP work that must stay out of services, so these handlers are slightly longer than the standard one-call handler. This is the only accepted exception; they contain no business logic. If your Elysia version types dynamic cookie keys differently, keep the behavior and adjust the syntax (`npm run check` tells you).

Schemas (`auth.schema.ts`): `registerBodySchema` = `{ email: format email maxLength 255, password: minLength 12 maxLength 128, name: minLength 1 maxLength 100 }`; `loginBodySchema` = `{ email, password: maxLength 128 }` (no min on login). Both `additionalProperties: false`.

Rules:

1. Login failures are identical for unknown email and wrong password: same 401 message, same CPU profile.
2. Password policy applies at registration/change only; login never rejects on length minimums.
3. Passwords, hashes, and tokens never appear in logs, errors, DTOs, or `select` shapes. `passwordHash` is selected only by `userRepository.findCredentialsByEmail`.
4. `normalizeEmail` is the single normalization function; the DB `CHECK (email = lower(email))` is the backstop.

## SvelteKit Session Bridge

`hooks.server.ts` authenticates once per page request so layouts can render user state and redirect (UX only). It calls the **same** `sessionService.authenticate` the API guard uses — there is no second verification implementation.

```ts
// src/hooks.server.ts
import type { Handle } from '@sveltejs/kit'
import { sequence } from '@sveltejs/kit/hooks'
import { sessionService, SESSION_COOKIE_NAME } from '$lib/server/modules/session'

const sessionBridge: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get(SESSION_COOKIE_NAME)
  event.locals.user = token ? await sessionService.authenticate(token) : null
  return resolve(event)
}

const securityHeaders: Handle = async ({ event, resolve }) => {
  const response = await resolve(event)
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains')
  return response
}

export const handle = sequence(securityHeaders, sessionBridge)
```

```ts
// src/app.d.ts
import type { AuthUser } from '$lib/server/modules/session'

declare global {
  namespace App {
    interface Locals { user: AuthUser | null }
  }
}
export {}
```

```ts
// src/routes/(app)/+layout.server.ts — UX guard; the API still enforces auth on every call
import { redirect } from '@sveltejs/kit'
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = ({ locals, url }) => {
  if (!locals.user) redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`)
  return { user: locals.user }
}
```

Validate the `next` redirect target on the login page (must start with a single `/`, never `//` or a scheme) to prevent open redirects. CSP is configured in `svelte.config.js` (`kit.csp`) — see [production-readiness.md](./production-readiness.md#security-headers-and-csp).

## Operational Rules

1. **CSRF:** cookie sessions require `csrfPlugin` (Origin check) plus `SameSite=Lax` ([security.md](./security.md#csrf)).
2. **Rate limiting:** credential endpoints have the strict per-IP plugin plus the per-account limiter. A per-account limiter allows an attacker to throttle a victim's logins; accepted trade-off at 10 attempts / 15 min.
3. **Audit log:** log security events (login success/failure, logout-everywhere, password change, role change) with `userId`, `requestId`, IP — never secrets.
4. **Roles** are read from the database on every request, so a role change takes effect immediately; delete the user's sessions on privilege **reduction** for defense in depth.
5. **MFA, OAuth/OIDC, magic links** are separate modules that call `sessionService.create`; never fork the session mechanism.
