# Elysia Patterns — Routes, Validation, Responses, and the Typed Client

How every Elysia route is defined. Elysia is mounted once inside SvelteKit ([architecture.md](./architecture.md#elysia--sveltekit-wiring)). Plugin implementations (guards, errors, rate limits) live in [design-patterns.md](./design-patterns.md) — they are not repeated here.

## Contents

- [Route Definition Standard](#route-definition-standard)
- [Validation Rules](#validation-rules)
- [Response Schemas](#response-schemas)
- [Guards and Authorization](#guards-and-authorization)
- [Status Code Conventions](#status-code-conventions)
- [Client-Side Calls (Eden Treaty)](#client-side-calls-eden-treaty)
- [Incorrect / Correct](#incorrect--correct)

## Route Definition Standard

Every route lives in `<feature>.routes.ts` and has this exact shape:

```ts
// src/lib/server/modules/post/post.routes.ts
import { Elysia, t } from 'elysia'
import { authPlugin } from '$lib/server/modules/session'
import { postService } from './post.service'
import {
  createPostBodySchema, listPostsQuerySchema, postDetailDtoSchema,
  postIdParamsSchema, postPageDtoSchema, updatePostBodySchema
} from './post.schema'

export const postRoutes = new Elysia({ name: 'post-routes', prefix: '/posts' })
  .use(authPlugin)
  .get('/', ({ user, query }) => postService.listByUser(user.id, query), {
    requireAuth: true,
    query: listPostsQuerySchema,
    response: { 200: postPageDtoSchema }
  })
  .get('/:id', ({ user, params }) => postService.getById(user.id, params.id), {
    requireAuth: true,
    params: postIdParamsSchema,
    response: { 200: postDetailDtoSchema }
  })
  // Pre-flight inspection for expensive AI / multi-entity generation (design-patterns.md §14)
  .get('/:id/scope', ({ user, params }) => postService.inspectScope(user.id, params.id), {
    requireAuth: true,
    params: postIdParamsSchema,
    response: { 200: scopeInspectionResponseSchema }
  })
  .post('/', async ({ user, body, set }) => {
    const created = await postService.create(user.id, body)
    set.status = 201
    return created
  }, {
    requireAuth: true,
    body: createPostBodySchema,
    response: { 201: postDetailDtoSchema }
  })
  .patch('/:id', ({ user, params, body }) => postService.update(user.id, params.id, body), {
    requireAuth: true,
    params: postIdParamsSchema,
    body: updatePostBodySchema,
    response: { 200: postDetailDtoSchema }
  })
  .delete('/:id', async ({ user, params, set }) => {
    await postService.remove(user.id, params.id)
    set.status = 204
  }, {
    requireAuth: true,
    params: postIdParamsSchema,
    response: { 204: t.Void() }
  })
```

Rules:

1. **A handler contains one service call plus, at most, `set.status`.** No `if`, loops, mapping, or queries — that belongs in the service.
2. **Every route declares schemas** for every input it reads: `body`, `query`, `params`, `headers`, `cookie`. A route without one is a defect.
3. **Every route declares a `response` schema** (see below).
4. **Every protected route declares exactly one guard flag** (`requireAuth: true` / `requireAdmin: true`).
5. Handlers pass the authenticated owner explicitly: `service.method(user.id, …)`.
6. Hooks and `.use()` come **before** the routes they must affect.

## Validation Rules

Validation happens at the boundary, once. Services receive already-valid, typed input.

```ts
// src/lib/server/modules/post/post.schema.ts
import { t } from 'elysia'
import { POST_STATUSES } from '$lib/shared/constants/post-status'
import { paginationQuerySchema } from '$lib/server/shared/pagination'

export const postStatusSchema = t.Union(POST_STATUSES.map((status) => t.Literal(status)))

export const postIdParamsSchema = t.Object({ id: t.String({ format: 'uuid' }) }, { additionalProperties: false })

export const listPostsQuerySchema = paginationQuerySchema          // reuse; extend with t.Composite for filters

export const createPostBodySchema = t.Object({
  title: t.String({ minLength: 3, maxLength: 200 }),
  content: t.String({ minLength: 1, maxLength: 50_000 }),
  status: t.Optional(postStatusSchema)
}, { additionalProperties: false })

export const updatePostBodySchema = t.Partial(createPostBodySchema, { minProperties: 1, additionalProperties: false })

export type ListPostsQuery = typeof listPostsQuerySchema.static
export type CreatePostBody = typeof createPostBodySchema.static
export type UpdatePostBody = typeof updatePostBodySchema.static
```

Rules:

1. **Constrain every field.** Strings get `minLength`/`maxLength` (and `format` for `email`/`uuid`), numbers get `minimum`/`maximum`, enums are `t.Union([t.Literal])` built from the shared constants. An unconstrained `t.String()` on user input is a defect.
2. **Numeric query/path values use `t.Numeric()`**, which coerces the string from the URL. `t.Number()` does not.
3. **Write schemas set `additionalProperties: false`** so unknown keys are rejected loudly (surfacing client bugs and blocking mass assignment). Still pick fields explicitly in the service — never spread `body` into a repository call.
4. **Defaults live in the schema** (`default: 20`) **and** in the service (`query.limit ?? DEFAULT_PAGE_SIZE`) because jobs and scripts call services without Elysia validation.
5. **Validate shape and bounds here; validate business rules in the service** (uniqueness, ownership, state transitions).
6. **One validation layer.** Do not re-validate a body in the service with a second schema.
7. **Types derive from the schema**: `typeof schema.static`. Never write an interface that mirrors a schema.
8. **Credentials fields:** passwords `maxLength: 128` (prevents hashing DoS); email `format: 'email', maxLength: 255`.
9. Set a global body size limit at the server (`BODY_SIZE_LIMIT` for adapter-node; see [production-readiness.md](./production-readiness.md)).

## Response Schemas

Every route declares `response: { <status>: <dtoSchema> }`. Elysia validates and strips what the DTO schema does not declare — a second line of defense against leaking columns — and Eden derives client types from it.

```ts
export const postSummaryDtoSchema = t.Object({ id: t.String(), title: t.String(), status: postStatusSchema, createdAt: t.String() })
export const postDetailDtoSchema = t.Composite([postSummaryDtoSchema, t.Object({ content: t.String() })])
export const postPageDtoSchema = t.Object({
  items: t.Array(postSummaryDtoSchema),
  nextCursor: t.Union([t.String(), t.Null()])
})
export type PostSummaryDto = typeof postSummaryDtoSchema.static
export type PostDetailDto = typeof postDetailDtoSchema.static
export type PostPageDto = typeof postPageDtoSchema.static
```

Rules:

1. Lists return `{ items, nextCursor }`, never a bare array.
2. Mappers (`post.mapper.ts`) are the only code that builds DTOs.
3. Never return a repository row from a route.

## Guards and Authorization

Guard implementations are in [design-patterns.md §4](./design-patterns.md#4-guard--policy); session semantics are in [auth-session.md](./auth-session.md).

1. Guards answer "who may call this endpoint". Repository `WHERE userId = ?` answers "whose data". Both are mandatory.
2. Never hand-roll token checks inside a handler.
3. After `requireAuth`, `user` (`{ id, role }`) is typed as defined; no `user!` or `user?.` in handlers.

## Status Code Conventions

| Situation | Status | Mechanism |
|---|---|---|
| Read / update | `200` | default |
| Created | `201` | `set.status = 201` |
| Deleted, no body | `204` | `set.status = 204`, `response: { 204: t.Void() }` |
| Malformed body | `400` | error plugin (`PARSE`, `BadRequestError`) |
| Validation failed | `422` | error plugin (`VALIDATION`) |
| Not logged in / bad session | `401` | `UnauthorizedError` |
| Logged in, not allowed | `403` | `ForbiddenError` |
| Not found **or not yours** | `404` | `NotFoundError` |
| Duplicate unique value | `409` | `ConflictError` |
| Rate limited | `429` | `TooManyRequestsError` (+ `Retry-After`) |
| Unexpected | `500` | error plugin (generic message) |

Use `404` (not `403`) when the existence of a resource is itself sensitive. Never return `200` with an error body.

## Client-Side Calls (Eden Treaty)

Use **Eden Treaty** (`@elysiajs/eden`) as the only API client: types flow from the server routes, so there are no hand-written fetch wrappers or duplicated DTO types.

```ts
// src/lib/api/client.ts
import { treaty } from '@elysiajs/eden'
import type { Api } from '$lib/server/api/app'   // type-only: erased at build, allowed exception to the server-import rule

/** SSR: pass event.fetch and url.origin (in-process, forwards cookies). Browser: pass nothing. */
export function createApiClient(fetcher: typeof fetch = fetch, origin = typeof location !== 'undefined' ? location.origin : '') {
  return treaty<Api>(origin, { fetcher })
}
```

```ts
const client = createApiClient()
const { data, error } = await client.api.posts.post({ title, content })
if (error) { /* error.status, error.value.error.code / message / requestId */ }
```

Rules:

1. All API access goes through `createApiClient`. No raw `fetch('/api/…')` in components.
2. Handle `401` centrally (redirect to `/login`) — in `treaty`'s `onResponse` hook or the load wrapper — not per component.
3. Only `import type` from `$lib/server` module roots (`Api`, DTO types). A runtime import is a violation.
4. Never put session tokens in `localStorage`/JS. The browser sends the httpOnly cookie automatically.

## Incorrect / Correct

**Incorrect — no validation, hand-rolled auth, ad-hoc shapes, raw row leaked:**

```ts
app.post('/posts', async ({ headers, body, set }) => {
  const user = await verify(headers.authorization)
  if (!user) { set.status = 401; return { error: 'no auth' } }
  if (!body.title) { set.status = 400; return { error: 'bad title' } }
  const [row] = await db.insert(posts).values({ ...body, userId: user.id }).returning()
  return row
})
```

**Correct — declarative; schema validates, macro authenticates, service owns rules, mapper shapes output:**

```ts
.post('/', async ({ user, body, set }) => {
  const created = await postService.create(user.id, body)
  set.status = 201
  return created
}, { requireAuth: true, body: createPostBodySchema, response: { 201: postDetailDtoSchema } })
```
