# Testing — Pyramid, Tooling, Templates, Authorization Tests

Tests are part of the definition of done. A feature without tests is unfinished, and a protected route without an authorization test is a security gap.

## Contents

- [Test Pyramid](#test-pyramid)
- [Tooling and Configuration](#tooling-and-configuration)
- [Unit Tests (Services)](#unit-tests-services)
- [Integration Tests (Repositories and Routes)](#integration-tests-repositories-and-routes)
- [Authorization Tests](#authorization-tests)
- [End-to-End Tests](#end-to-end-tests)
- [Rules and Thresholds](#rules-and-thresholds)

## Test Pyramid

| Level | Scope | Database | Runs | Naming |
|---|---|---|---|---|
| Unit | Services, mappers, pure helpers (`shared/`) | None — repositories mocked | every save / every PR | `<file>.test.ts` |
| Integration | Repositories (real SQL) and routes via `api.handle()` | **Real PostgreSQL** (separate `*_test` database) | every PR | `<feature>.integration.test.ts` |
| E2E | 3–5 critical user journeys in a browser (Playwright) | Real PostgreSQL | every PR (smoke) / nightly (full) | `e2e/*.spec.ts` |

Do **not** mock the database in integration tests: SQL, constraints, indexes, and transactions are exactly what must be proven. Do **not** test framework behavior (that Elysia validates a `t.String`); test your schemas' bounds and your rules.

## Tooling and Configuration

Vitest with the SvelteKit Vite plugin (so `$lib`, `$env`, and `$app` resolve):

```ts
// vitest.config.ts
import { sveltekit } from '@sveltejs/kit/vite'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [sveltekit()],
  resolve: { alias: { $tests: fileURLToPath(new URL('./tests', import.meta.url)) } },
  test: {
    projects: [   // Vitest ≥ 3 ("workspace" in older versions)
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.integration.test.ts'],
          environment: 'node',
          setupFiles: ['./tests/unit-setup.ts']
        }
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.integration.test.ts'],
          environment: 'node',
          globalSetup: ['./tests/global-setup.ts'],
          setupFiles: ['./tests/setup.ts'],
          fileParallelism: false            // files share one test database
        }
      }
    ],
    coverage: {
      provider: 'v8',
      include: ['src/lib/server/**/*.ts'],
      thresholds: { lines: 80 }
    }
  }
})
```

`package.json` scripts: `"test:unit": "vitest run --project unit"`, `"test:integration": "vitest run --project integration"`, `"test": "vitest run"`.

```ts
// tests/unit-setup.ts — sets dummy environment variables for unit tests without needing a live database
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test'
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/app_test?sslmode=disable'
process.env.ORIGIN = process.env.ORIGIN ?? 'http://localhost:3000'
process.env.APP_ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:3000'
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent'
```

```ts
// tests/helpers/guard.ts — tests TRUNCATE tables: refuse to run against anything but a test database
export function assertTestDatabase(url: string | undefined): asserts url is string {
  if (!url || !new URL(url).pathname.endsWith('_test')) {
    throw new Error('Integration tests require DATABASE_URL pointing to a database whose name ends with "_test".')
  }
}
```

```ts
// tests/global-setup.ts — migrate the test database once per run
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { assertTestDatabase } from './helpers/guard'

export default async function setup() {
  config({ path: '.env.test' })
  const url = process.env.DATABASE_URL
  assertTestDatabase(url)
  const pool = new Pool({ connectionString: url, max: 1 })
  try { await migrate(drizzle(pool), { migrationsFolder: './drizzle' }) } finally { await pool.end() }
}
```

```ts
// tests/setup.ts — clean state before each test
import { sql } from 'drizzle-orm'
import { beforeEach } from 'vitest'
import { db } from '$lib/server/db'
import { env } from '$lib/server/env'
import { assertTestDatabase } from './helpers/guard'

assertTestDatabase(env.DATABASE_URL)   // second line of defense: the app's own connection must also be a test DB

beforeEach(async () => {
  const { rows } = await db.execute<{ tablename: string }>(sql`select tablename from pg_tables where schemaname = 'public'`)
  const tables = rows.map((row) => `"${row.tablename}"`).join(', ')
  if (tables) await db.execute(sql.raw(`truncate table ${tables} restart identity cascade`))   // static, database-derived names only
})
```

Load test env from `.env.test` (`vitest --mode test`); it contains `DATABASE_URL=postgres://…/app_test` and `ORIGIN=http://localhost:5173`. Provide a `docker-compose.test.yml` with PostgreSQL on a non-default port.

Test helpers live in `tests/helpers/` and are the only place that creates fixtures:

```ts
// tests/helpers/api.ts
import { api } from '$lib/server/api/app'
import { env } from '$lib/server/env'
import { sessionService } from '$lib/server/modules/session'
import { userService } from '$lib/server/modules/user'
import type { Role } from '$lib/shared/constants/roles'

let counter = 0

export async function createTestUser(role: Role = 'user') {
  counter += 1
  const user = await userService.create({ email: `user${counter}@example.com`, name: `User ${counter}`, passwordHash: 'not-used', role })
  const { token } = await sessionService.create(user.id)
  return { user, token }
}

export function apiRequest(path: string, options: { method?: string; body?: unknown; token?: string } = {}) {
  const headers = new Headers({ origin: env.ORIGIN, 'x-client-ip': '127.0.0.1' })
  if (options.token) headers.set('cookie', `session=${options.token}`)
  if (options.body !== undefined) headers.set('content-type', 'application/json')
  return api.handle(new Request(`${env.ORIGIN}/api${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  }))
}
```

## Unit Tests (Services)

Mock the **repository**, assert business rules. No database, no HTTP.

```ts
// src/lib/server/modules/post/post.service.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '$lib/server/errors/domain-error'
import { postRepository } from './post.repository'
import { postService } from './post.service'

vi.mock('./post.repository')

describe('postService.getById', () => {
  beforeEach(() => vi.resetAllMocks())

  it('throws NotFoundError when the post does not exist for that user', async () => {
    vi.mocked(postRepository.findByIdForUser).mockResolvedValue(undefined)
    await expect(postService.getById('user-1', 'post-1')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('scopes the lookup to the requesting user', async () => {
    vi.mocked(postRepository.findByIdForUser).mockResolvedValue(undefined)
    await postService.getById('user-1', 'post-1').catch(() => undefined)
    expect(postRepository.findByIdForUser).toHaveBeenCalledWith('user-1', 'post-1')
  })
})
```

Rules:

1. One behavior per test; name = behavior ("returns 404 when…", "throws ConflictError when…").
2. Arrange / Act / Assert, visibly separated.
3. Test the unhappy paths first: not found, conflict, forbidden, invalid state, boundary values (limit 1 / 50 / 51).
4. Pure helpers (`parseCursor`, `toPage`, mappers) get table-driven tests (`it.each`), including malformed input.

## Integration Tests (Repositories and Routes)

```ts
// src/lib/server/modules/post/post.integration.test.ts
import { describe, expect, it } from 'vitest'
import { apiRequest, createTestUser } from '$tests/helpers/api'

describe('POST /api/posts and GET /api/posts', () => {
  it('creates a post and lists it with a stable cursor', async () => {
    const { token } = await createTestUser()
    for (const title of ['one', 'two', 'three']) {
      const created = await apiRequest('/posts', { method: 'POST', token, body: { title: `Post ${title}`, content: 'Body text' } })
      expect(created.status).toBe(201)
    }

    const firstPage = await (await apiRequest('/posts?limit=2', { token })).json()
    expect(firstPage.items).toHaveLength(2)
    expect(firstPage.nextCursor).toEqual(expect.any(String))

    const secondPage = await (await apiRequest(`/posts?limit=2&cursor=${firstPage.nextCursor}`, { token })).json()
    expect(secondPage.items).toHaveLength(1)
    expect(secondPage.nextCursor).toBeNull()
  })

  it('rejects an invalid body with the standard envelope', async () => {
    const { token } = await createTestUser()
    const response = await apiRequest('/posts', { method: 'POST', token, body: { title: 'x', extra: true } })
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
  })

  it('rejects a malformed cursor with 400, not 500', async () => {
    const { token } = await createTestUser()
    const response = await apiRequest('/posts?cursor=not-a-cursor', { token })
    expect(response.status).toBe(400)
  })
})
```

Repository tests additionally assert **query behavior**: pagination order with equal timestamps (tie-break by `id`), ownership scoping, `onConflictDoNothing` results, and transaction rollback (throw inside `withTransaction` and assert nothing was persisted).

## Authorization Tests

**Mandatory for every protected route.** Use a table so adding a route forces adding a row:

```ts
describe.each([
  { method: 'GET', path: '/posts' },
  { method: 'POST', path: '/posts', body: { title: 'abc', content: 'x' } }
])('$method $path', ({ method, path, body }) => {
  it('returns 401 without a session', async () => {
    expect((await apiRequest(path, { method, body })).status).toBe(401)
  })
})

describe('post ownership (IDOR)', () => {
  it("returns 404 when reading another user's post", async () => {
    const owner = await createTestUser()
    const intruder = await createTestUser()
    const created = await (await apiRequest('/posts', { method: 'POST', token: owner.token, body: { title: 'Secret', content: 'x' } })).json()

    expect((await apiRequest(`/posts/${created.id}`, { token: intruder.token })).status).toBe(404)
    expect((await apiRequest(`/posts/${created.id}`, { method: 'DELETE', token: intruder.token })).status).toBe(404)
    expect((await apiRequest(`/posts/${created.id}`, { token: owner.token })).status).toBe(200)   // unchanged for the owner
  })
})

it('returns 403 for a non-admin on an admin route', async () => {
  const { token } = await createTestUser('user')
  expect((await apiRequest('/admin/export', { method: 'POST', token })).status).toBe(403)
})
```

Also cover: expired session → 401, logout invalidates the token, login with unknown email and wrong password return identical bodies, CSRF (cross-origin `POST` with cookie → 403), and rate limit (21st auth request → 429 with `Retry-After`).

## End-to-End Tests

Playwright, a handful of high-value journeys only: register → login → create → see in list → logout; unauthenticated redirect to `/login`; one admin flow. Use accessible locators (`getByRole`, `getByLabel`), never CSS chains. Run against the production build (`npm run build && node build`) with the test database.

## Rules and Thresholds

1. **Definition of done:** new/changed service → unit tests; new/changed repository query or route → integration test; new protected route → authorization rows; bug fix → a regression test that fails before the fix.
2. **Coverage:** ≥ 90% lines for services, mappers, and `shared/`; ≥ 80% overall for `src/lib/server`. Coverage measures untested code; it is not the goal.
3. **Deterministic:** no `setTimeout` sleeps, real clocks, or random ids in assertions; use `vi.useFakeTimers()` and injected values.
4. **Independent:** each test sets up its own data (helpers) and relies on no order.
5. **Fast:** unit suite < 10 s; integration suite < 2 min on CI. A slow test needs a reason.
6. **No snapshots of database rows or DTOs** with ids/timestamps; assert specific fields.
7. **Tests follow the same code-quality rules** (English, no `any`, no duplication — extract helpers).
8. A flaky test is fixed or deleted the same day; never retried into silence.
