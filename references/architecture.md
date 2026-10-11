# Architecture — Layered Vertical Slices for the TESD Stack

This is a **pragmatic clean architecture**: dependencies point inward, business rules never import the database library or HTTP, and every feature is a self-contained vertical slice. Services depend on repository *functions* (not on Drizzle), so business logic can be tested and moved without touching SQL.

## Contents

- [Layer Model](#layer-model)
- [Dependency Rules](#dependency-rules)
- [Module Boundaries](#module-boundaries)
- [Feature Module Anatomy](#feature-module-anatomy)
- [Elysia × SvelteKit Wiring](#elysia--sveltekit-wiring)
- [UI Data Flow: One Boundary](#ui-data-flow-one-boundary)
- [Where Types and Constants Live](#where-types-and-constants-live)
- [Enforcing the Rules with ESLint](#enforcing-the-rules-with-eslint)
- [Scaling Rules for Big Projects](#scaling-rules-for-big-projects)
- [Incorrect / Correct](#incorrect--correct)

## Layer Model

```
┌──────────────────────────────────────────────────────────────┐
│ 1. Presentation                                              │
│    Svelte pages/components · Elysia route plugins · plugins  │
│    → HTTP only: parse, validate, authenticate, shape output  │
├──────────────────────────────────────────────────────────────┤
│ 2. Business (Service)                                        │
│    <feature>.service.ts · domain errors · mappers            │
│    → Rules, orchestration, transactions, authorization policy│
├──────────────────────────────────────────────────────────────┤
│ 3. Data Access (Repository)                                  │
│    <feature>.repository.ts                                   │
│    → The ONLY code that imports drizzle-orm / db schema      │
├──────────────────────────────────────────────────────────────┤
│ 4. Infrastructure                                            │
│    db client · transaction helper · env · logger · schema    │
└──────────────────────────────────────────────────────────────┘
```

Four layers, no more. Do not add "manager", "handler helper", or "facade" tiers that only forward calls.

## Dependency Rules

1. **One direction only:** route → service → repository → db. A lower layer never imports a higher one.
2. **Routes never import `db`, `drizzle-orm`, schema tables, or repositories.** They call services only.
3. **Services never import `drizzle-orm` or `$lib/server/db/schema`.** They call repositories, and use `withTransaction` from `$lib/server/db/transaction` for atomic work.
4. **Services never touch HTTP:** no `set.status`, no status numbers, no headers, no cookies, no `Request`. They throw domain errors (`NotFoundError`, `ConflictError`); the error plugin maps them to HTTP.
5. **Repositories never throw domain errors and never map DTOs.** A missing row returns `undefined`/`null`; the service decides what that means.
6. **Domain errors live in `$lib/server/errors/domain-error.ts`**, never inside API plugins.
7. **Client code never has a runtime import of `$lib/server`** (SvelteKit also fails the build). Type-only imports from a module root (`import type { PostSummaryDto }`, `import type { Api }`) are allowed: they are erased at build, and are how DTO types reach the UI.
8. **Shared code moves down, not sideways.** Logic needed by two modules goes to `$lib/server/shared/` (server) or `$lib/shared/` (isomorphic), never into one feature that the other imports.
9. **Module dependency graph is a DAG.** No import cycles between modules (`npm run deps:cycles` must pass).

## Module Boundaries

Every module exposes a **public API** through its `index.ts`. Everything else in the folder is private.

```ts
// src/lib/server/modules/user/index.ts — the ONLY file other modules may import
export { userRoutes } from './user.routes'
export { userService } from './user.service'
export type { UserDto } from './user.schema'
```

Rules:

1. **Inside a module, use relative imports** (`./user.service`). **Across modules, import the alias of the module root** (`$lib/server/modules/user`). Deep imports (`$lib/server/modules/user/user.repository`) are forbidden and blocked by ESLint.
2. **Cross-module calls go service → service.** Module A never calls module B's repository.
3. **Read-only joins across modules are allowed inside a repository** (e.g. `sessions` joined with `users` for a projection). **Writes to another module's tables are never allowed** — call that module's service.
4. **A module owns its tables.** The table file is `db/schema/<feature>.ts`; only that module's repository writes to it.
5. If two modules call each other's services, extract the shared concept into a third module or `shared/` — never accept a cycle.

## Feature Module Anatomy

Organized **by feature (vertical)**, not by layer. Everything for one feature lives in one folder:

```
src/lib/server/modules/post/
├── index.ts               # Public API (routes + service + public types)
├── post.routes.ts         # Elysia plugin: path, schemas, guard flag, one service call
├── post.schema.ts         # TypeBox: input schemas, response DTO schemas, static types
├── post.service.ts        # Business rules, orchestration, transactions
├── post.repository.ts     # Drizzle queries; accepts an optional executor (db | tx)
├── post.mapper.ts         # row → DTO (only place this transformation happens)
├── post.service.test.ts   # Unit tests (repository mocked)
└── post.integration.test.ts  # Repository + routes against real PostgreSQL
```

All files are required except `mapper` when the DTO equals the selected row shape (then map inline in the service via a tiny named function). **Never** create a file per function, and **never** a single giant `service.ts` shared by all features.

## Elysia × SvelteKit Wiring

Elysia runs inside SvelteKit as a catch-all server route. Mount it exactly once.

```ts
// src/routes/api/[...slugs]/+server.ts
import type { RequestHandler } from './$types'
import { api } from '$lib/server/api/app'

// getClientAddress() honours adapter-node proxy settings (ADDRESS_HEADER, XFF_DEPTH).
// Overwrite x-client-ip so a client can never spoof it.
const handle: RequestHandler = ({ request, getClientAddress }) => {
  const headers = new Headers(request.headers)
  headers.set('x-client-ip', getClientAddress())
  return api.handle(new Request(request, { headers }))
}

export const fallback = handle
```

```ts
// src/lib/server/api/app.ts
import { Elysia } from 'elysia'
import { requestContextPlugin } from './plugins/request-context.plugin'
import { errorPlugin } from './plugins/error.plugin'
import { csrfPlugin } from './plugins/csrf.plugin'
import { rateLimitPlugin } from './plugins/rate-limit.plugin'
import { authRoutes } from '$lib/server/modules/auth'
import { postRoutes } from '$lib/server/modules/post'
import { userRoutes } from '$lib/server/modules/user'

// Order matters: context → errors → security → feature routes.
export const api = new Elysia({ prefix: '/api' })
  .use(requestContextPlugin)
  .use(errorPlugin)
  .use(csrfPlugin)
  .use(rateLimitPlugin({ name: 'global', windowMs: 60_000, max: 300 }))
  .use(authRoutes)
  .use(userRoutes)
  .use(postRoutes)

export type Api = typeof api
```

Rules:

- **Exactly one catch-all.** Add routes to feature plugins; never add more `+server.ts` files under `src/routes/api/`. Endpoints outside `/api` (`/healthz`, `/readyz`) are fine.
- Runtime is Node (SvelteKit `adapter-node`): use `drizzle-orm/node-postgres`, not Bun drivers.
- Elysia hooks apply only to routes declared **after** the hook. In every plugin, call `.use(...)` for guards/limiters **before** defining routes.
- Every feature route plugin calls `.use(authPlugin)` (or the auth module's plugin) itself so the guard macros and the typed `user` are available; Elysia deduplicates by `name`.

## UI Data Flow: One Boundary

The Elysia API is the **only** entry point for application data. This gives one validation path, one authorization path, and one place to add rate limits and logs.

- `+page.server.ts` / `+layout.server.ts` load functions call the API **in-process** through the Eden client using SvelteKit's `event.fetch` (no network hop; cookies are forwarded for same-origin requests).
- Client-side interactions use the same Eden client in the browser.
- **Pages and actions never import services or repositories.** Form actions, if used, only forward to the API with `event.fetch` — they never re-implement validation or authorization.
- **Allowed direct service callers outside Elysia:** `hooks.server.ts` (session bridge), `/healthz` + `/readyz`, scripts, and background jobs (their input is internal/trusted).
- UI route guards (`redirect(303, '/login')` when `locals.user` is null) are **UX only**. Security is enforced by the API guards and repository `WHERE` clauses.

```ts
// src/routes/(app)/posts/+page.server.ts
import { createApiClient } from '$lib/api/client'
import { error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

export const load: PageServerLoad = async ({ fetch, url }) => {
  const client = createApiClient(fetch, url.origin)
  const { data, error: apiError } = await client.api.posts.get({
    query: { cursor: url.searchParams.get('cursor') ?? undefined }
  })
  if (apiError) error(apiError.status, 'Unable to load posts')
  return { page: data }
}
```

See [elysia-patterns.md](./elysia-patterns.md#client-side-calls-eden-treaty) for the client factory and [auth-session.md](./auth-session.md#sveltekit-session-bridge) for `locals.user`.

## Where Types and Constants Live

One source of truth per category:

| Concept | Source of truth | Never |
|---|---|---|
| DB row shape | `typeof table.$inferSelect` / `$inferInsert` (exported from the repository) | Hand-written row interfaces |
| Request shape | TypeBox schema in `<feature>.schema.ts`; type via `typeof schema.static` | Duplicate Zod/TS interfaces |
| Response shape | TypeBox DTO schema in `<feature>.schema.ts`; mapper returns that type | Returning raw rows |
| Enumerations used by DB + validation + UI (roles, statuses) | `src/lib/shared/constants/<name>.ts` as `as const` arrays | Re-declaring the values in `pgEnum`, TypeBox, and Svelte separately |
| Pagination limits | `src/lib/shared/constants/pagination.ts` | Magic numbers in schemas/services |
| Environment | `env.ts` | `process.env` / `$env` reads in modules |

## Enforcing the Rules with ESLint

Rules that are only written in docs rot. Enforce layering mechanically (ESLint flat config; adapt paths).

ESLint flat config does **not merge** options of the same rule across matching config objects — the last match wins. Therefore every file group below declares its **complete** pattern list, built from shared constants:

```js
// eslint.config.js (excerpt)
const DEEP_MODULE_IMPORT = { group: ['$lib/server/modules/*/*'], message: 'Import the module root (its index.ts) only.' }
const DRIZZLE = { group: ['drizzle-orm', 'drizzle-orm/*', '$lib/server/db', '$lib/server/db/schema', '$lib/server/db/schema/*'], message: 'Only repositories may use Drizzle.' }
const DATA_LAYER = { group: ['$lib/server/db/*', '**/*.repository'], message: 'Call services only; never the data layer.' }

const restrict = (...patterns) => ({ 'no-restricted-imports': ['error', { patterns }] })

export default [
  // Default for all source files
  { files: ['src/**/*.{ts,svelte}'], rules: restrict(DEEP_MODULE_IMPORT) },
  // Services: no Drizzle (db/transaction is allowed: it is not matched by DRIZZLE)
  { files: ['src/lib/server/modules/**/*.service.ts'], rules: restrict(DEEP_MODULE_IMPORT, DRIZZLE) },
  // Routes, plugins, pages: no data layer at all
  {
    files: ['src/lib/server/modules/**/*.routes.ts', 'src/lib/server/api/**/*.ts', 'src/routes/**/*.ts'],
    rules: restrict(DEEP_MODULE_IMPORT, DRIZZLE, DATA_LAYER)
  }
]
```

Verify the config once with a deliberate violation (e.g. import `drizzle-orm` in a service) and confirm `npm run lint` fails. Add `madge --circular` (`npm run deps:cycles`) to CI. Note: `src/lib/server/modules/**/index.ts` and tests are exempt from `DATA_LAYER` by not matching the groups above.

## Scaling Rules for Big Projects

1. **Add features as new modules; do not grow existing ones past their purpose.** Split a module when its service exceeds ~400 lines or serves two unrelated nouns.
2. **File size smells:** service/repository > 400 lines, route file > 150 lines, Svelte component > 250 lines → split by responsibility.
3. **Public API stays small.** A module exports a service, its routes, and DTO types. Repository and mapper stay private.
4. **Policy lives in the service.** Fine-grained permissions (`can publish?`) are service-level functions (`assertCanPublish(user, post)`), not guard macros. Guards only answer "who may call this endpoint".
5. **No premature microservices/CQRS/event-sourcing.** A new pattern requires a written reason (ADR in `docs/adr/NNN-title.md`: context, decision, consequences).
6. **Naming is a contract.** Follow [code-quality.md](./code-quality.md#naming-conventions) exactly; new contributors and agents find files by predictable names.
7. **Breaking API changes** are versioned by path prefix (`/api/v2/...`) with a new route plugin, never by silently changing a DTO consumed by external clients.
8. **Every module has tests** colocated with it; see [testing.md](./testing.md).

## Incorrect / Correct

**Incorrect — fat route (HTTP + auth + query + business rule + leaking mapper):**

```ts
export const postRoutes = new Elysia({ prefix: '/posts' })
  .get('/', async ({ headers, query, set }) => {
    const user = await verifyToken(headers.authorization)      // hand-rolled auth
    if (!user) { set.status = 401; return 'Unauthorized' }
    const rows = await db.select().from(posts)                 // route queries db, select *
      .where(eq(posts.userId, user.id))
    return rows.sort((a, b) => +b.createdAt - +a.createdAt)    // business rule in route, no limit
      .map(({ internalNote, ...pub }) => pub)
  })
```

**Correct — thin route; rules in the service; SQL in the repository:**

```ts
// post.routes.ts
export const postRoutes = new Elysia({ name: 'post-routes', prefix: '/posts' })
  .use(authPlugin)
  .get('/', ({ user, query }) => postService.listByUser(user.id, query), {
    requireAuth: true,
    query: listPostsQuerySchema,
    response: { 200: postPageDtoSchema }
  })
```

```ts
// post.service.ts — no Drizzle, no HTTP
export const postService = {
  async listByUser(userId: string, query: ListPostsQuery): Promise<PostPageDto> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE
    const rows = await postRepository.findPageByUser(userId, { limit, cursor: parseCursor(query.cursor) })
    const page = toPage(rows, limit)
    return { items: page.items.map(toPostSummaryDto), nextCursor: page.nextCursor }
  }
}
```

The test of this architecture: **adding business rules must not make routes or repositories fatter.** Full working example: [playbooks.md](./playbooks.md#reference-implementation-post-module).
