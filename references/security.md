# Security — Authorization, Injection, CSRF, and Threat Prevention

Mandatory security rules for TESD projects. When unsure, choose the more restrictive option and tell the user. Authentication/session mechanics are in [auth-session.md](./auth-session.md); infrastructure headers and deployment hardening are in [production-readiness.md](./production-readiness.md).

## Contents

- [Authorization Rules](#authorization-rules)
- [Input Handling](#input-handling)
- [Password Handling](#password-handling)
- [SQL Injection](#sql-injection)
- [XSS](#xss)
- [CSRF](#csrf)
- [Secrets Management](#secrets-management)
- [Rate Limiting](#rate-limiting)
- [Error Hygiene and Logging](#error-hygiene-and-logging)
- [File Uploads](#file-uploads)
- [SSRF and Outbound Requests](#ssrf-and-outbound-requests)
- [Dependencies and Supply Chain](#dependencies-and-supply-chain)
- [OWASP Top 10 Mapping](#owasp-top-10-mapping)
- [Security Review Checklist](#security-review-checklist)

## Authorization Rules

Authentication (WHO are you) and authorization (WHAT may you touch) are separate checks. Both are mandatory on every protected route.

1. **Every protected route declares a guard flag** (`requireAuth: true` / `requireAdmin: true`). A protected route without one is a security defect.
2. **Ownership is enforced in the repository SQL**, never by fetch-then-compare in JavaScript:

```ts
// WRONG: race-prone double read, and every new call site can forget the check
const post = await postRepository.findById(postId)
if (post.userId !== user.id) throw new ForbiddenError()

// RIGHT: the query can only ever return or change rows the user owns
const [row] = await executor.update(posts).set(patch)
  .where(and(eq(posts.id, postId), eq(posts.userId, userId)))
  .returning()
if (!row) throw new NotFoundError('Post not found')      // 404, not 403: existence stays private
```

3. **Repository methods for user-owned tables always take `userId`** (`findByIdForUser`, `deleteForUser`). A method that takes only `id` on a user-owned table is a defect.
4. **Never accept an owner id from the client** on user-facing routes (`userId` in body/query/params). Owner = `user.id` from the verified session.
5. **Roles come from the database** via the session lookup, never from a client-sent field.
6. **Multi-step flows re-check state and ownership in the service** (e.g. "publish" re-verifies the post is a draft owned by the user); a route guard alone is not enough.
7. **Fine-grained permissions** are service functions (`assertCanPublish(user, post)`); guards only gate endpoint access.
8. **Every protected route has an authorization test**: unauthenticated → 401, other user's resource → 404, non-admin on admin route → 403 ([testing.md](./testing.md#authorization-tests)).

## Input Handling

1. All input is validated by Elysia schemas with bounds ([elysia-patterns.md](./elysia-patterns.md#validation-rules)).
2. **Mass assignment:** never spread `body` into a write; pick fields explicitly in the service.
3. **Open redirects:** a `next`/`redirect` parameter must be a relative path starting with a single `/`; reject `//`, backslashes, and schemes.
4. **Never trust headers** that identify the client (`X-Forwarded-For`, `X-Client-Ip`) — the catch-all overwrites `x-client-ip` from SvelteKit's `getClientAddress()`.

## Password Handling

```ts
import { hash, verify } from '@node-rs/argon2'

const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const   // OWASP minimum for argon2id
```

1. **argon2id with explicit parameters** (`@node-rs/argon2`), or bcrypt with cost ≥ 12. Never MD5, SHA-1, SHA-256, or library defaults you have not verified.
2. Registration: `minLength: 12`, `maxLength: 128`. Login: `maxLength: 128` only.
3. **Equalize timing** for unknown accounts with a **real** precomputed hash (`getDummyHash()` in [auth-session.md](./auth-session.md#auth-module)). A fake, unparsable hash string defeats the purpose.
4. Passwords never appear in logs, errors, DTOs, or select shapes. `passwordHash` is selected only by the credentials lookup.
5. Changing a password revokes all sessions.

## SQL Injection

Drizzle's query builder always parameterizes. The danger is only at the escape hatches:

1. **`sql.raw(...)` is forbidden** with any runtime-derived value.
2. **`sql` tagged templates** may interpolate Drizzle columns and `${value}` parameters (which are bound, not concatenated). Never build the template string with `+` or template literals first.
3. **Never build identifiers (columns, tables, `ORDER BY`) from input.** Map input to a closed allowlist:

```ts
const SORTABLE = { createdAt: posts.createdAt, title: posts.title } as const
type SortKey = keyof typeof SORTABLE
const isSortKey = (value: string): value is SortKey => Object.hasOwn(SORTABLE, value)

const orderColumn = isSortKey(query.sort) ? SORTABLE[query.sort] : posts.createdAt
```

   (The schema should also restrict `sort` to the allowed literals.)
4. **`LIKE`/`ILIKE` input must escape `\`, `%`, `_`** ([drizzle-patterns.md](./drizzle-patterns.md#search)).
5. Sort direction comes from `asc()`/`desc()` chosen by a boolean, never from string interpolation.

## XSS

1. **Never use `{@html …}` with user-derived content.** If rich content is a requirement, sanitize server-side with an allowlist sanitizer (e.g. `sanitize-html`/DOMPurify) and flag it for review.
2. Svelte escapes `{…}` interpolation; use it everywhere.
3. API responses are JSON; never build HTML strings from user input server-side.
4. Set a **Content-Security-Policy** ([production-readiness.md](./production-readiness.md#security-headers-and-csp)) so any missed injection is contained.
5. Never serve user-uploaded files inline as `text/html`/`image/svg+xml` from the app origin.

## CSRF

Sessions ride in cookies, so state-changing requests need protection:

1. `SameSite=Lax` cookies (default in [auth-session.md](./auth-session.md#token-and-cookie-rules)).
2. `csrfPlugin` rejects non-safe methods whose `Origin` does not equal `env.ORIGIN`, or that carry cookies without an `Origin` ([design-patterns.md §10](./design-patterns.md#10-middleware-plugins)).
3. State changes are **never** performed by `GET`.
4. Requests authenticated by `Authorization: Bearer` carry no ambient credentials and are exempt from the Origin check.
5. SvelteKit's built-in `csrf.checkOrigin` stays **enabled** (default) for form posts.
6. If a cross-origin SPA must call the API, add `@elysiajs/cors` with an explicit origin allowlist from `env`, `credentials: true` only for listed origins — never `origin: true` or `*` with credentials.

## Secrets Management

1. Secrets enter **only through `env.ts`**. No `process.env`/`$env` scattered in modules; no secrets in routes, services, or client code.
2. `.env` is gitignored (verify before the first commit); `.env.example` documents every variable with placeholders.
3. Any signing/encryption secret: ≥ 32 random bytes, unique per environment, validated at boot in `env.ts`.
4. Client-visible variables use SvelteKit's `PUBLIC_` prefix and are never a DB URL, key, or token.
5. Never log secrets. The logger redacts `password`, `passwordHash`, `token`, `authorization`, `cookie` ([production-readiness.md](./production-readiness.md#logging)).
6. If a secret reaches a commit (even locally), tell the user immediately: **rotation**, not `git rm`, is the fix.

## Rate Limiting

Numbers, not adjectives (defaults; tune per product):

| Surface | Limit | Key |
|---|---|---|
| Global API | 300 requests / minute | client IP |
| `/auth/*` | 20 requests / 15 min | client IP |
| Login | 10 attempts / 15 min | normalized email |
| Password reset, OTP, email send | 5 / hour | account + IP |

1. 429 uses the standard envelope (`RATE_LIMITED`) with `Retry-After`.
2. Brute-force responses never reveal whether an account exists.
3. The in-memory limiter is per process. With more than one instance, implement `RateLimiter` on Redis (same interface).
4. The client IP comes from `x-client-ip`; configure adapter-node's `ADDRESS_HEADER` and `XFF_DEPTH` for your proxy chain, or every request appears to come from the proxy.

## Error Hygiene and Logging

1. Production errors are generic: `{ error: { code: 'INTERNAL', message: 'Internal server error', requestId } }`. Never `err.message`, stack, SQL, paths, or driver details.
2. Validation errors return field paths, never submitted values.
3. The error plugin logs unexpected errors with `requestId`; support correlates the id from the response.
4. `401` (not authenticated) / `403` (authenticated, not allowed) / `404` (not visible to you) are used precisely; they are a security control.
5. **Audit security events** (login success/failure, logout-everywhere, password/role change, admin actions) with `userId`, `requestId`, IP.

## File Uploads

1. Validate extension allowlist, sniffed MIME type, and size (`t.File({ maxSize, type })` or explicit checks) before storing.
2. Generate server-side names (UUIDs); never use the supplied filename on disk or in object keys.
3. Serve from a separate origin or with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
4. Large files: pre-signed upload URLs; credentials in `env.ts`.
5. Images: re-encode server-side to strip metadata and payloads.

## SSRF and Outbound Requests

1. Never fetch a user-supplied URL without an allowlist of hosts/schemes; block private/link-local ranges (`10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `127/8`, `::1`).
2. Set timeouts and response size caps on every outbound call; never forward cookies/session tokens.
3. Verify webhook signatures (HMAC) with constant-time comparison; reject stale timestamps.

## Dependencies and Supply Chain

1. Commit the lockfile; CI uses `npm ci` (or the pnpm/bun equivalent with frozen lockfile).
2. `npm audit --omit=dev --audit-level=high` runs in CI and blocks on findings; Dependabot/Renovate opens update PRs.
3. Add dependencies deliberately: maintained, widely used, and necessary. Prefer the platform (`crypto`, `fetch`) over a package.
4. Pin the Node version (`.nvmrc` / `engines`) and base image digest.

## OWASP Top 10 Mapping

| Risk | Where this guide handles it |
|---|---|
| A01 Broken Access Control | Guard flags + ownership in repository SQL + authorization tests |
| A02 Cryptographic Failures | argon2id with explicit params, hashed session tokens, `Secure` cookies, HSTS |
| A03 Injection | Parameterized Drizzle, `sql.raw` ban, identifier allowlists, LIKE escaping, CSP |
| A04 Insecure Design | Layering, single API boundary, `additionalProperties: false`, response DTO schemas |
| A05 Security Misconfiguration | Boot-validated `env.ts`, security headers, generic prod errors, strict CORS |
| A06 Vulnerable Components | Lockfile, `npm audit` gate, automated update PRs |
| A07 Authentication Failures | Identical login failures, real dummy hash, rate limits, revocable sessions |
| A08 Data Integrity Failures | Reviewed migrations, DB constraints, validated input only, signed webhooks |
| A09 Logging Failures | Structured logs with `requestId`, audit events, secret redaction |
| A10 SSRF | Host allowlist + private-range blocking for outbound fetches |

## Security Review Checklist

- [ ] Every route has a guard flag (unless intentionally public) and an authorization test
- [ ] Every repository method on user-owned data takes `userId` and filters in SQL
- [ ] No `sql.raw`, no string-built SQL, no input-derived identifiers
- [ ] No `{@html}` with user content; CSP configured
- [ ] No secrets in code, logs, or client bundle; `.env.example` current
- [ ] Credentials endpoints rate-limited; failures indistinguishable
- [ ] Error responses are generic in production and carry `requestId`
- [ ] New dependencies justified; `npm audit` clean
