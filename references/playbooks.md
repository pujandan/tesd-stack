# Playbooks — Step-by-Step Guides & Reference Implementations

Operational recipes for AI agents and developers working on the TESD stack. Follow these exact steps to avoid common architectural defects, missed tests, or broken module boundaries.

## Contents

- [Playbook 1: Add a New Feature Module](#playbook-1-add-a-new-feature-module)
- [Playbook 2: Bootstrap a New Project](#playbook-2-bootstrap-a-new-project)
- [Reference Implementation: Post Module](#reference-implementation-post-module)

---

## Playbook 1: Add a New Feature Module

Follow this layer-by-layer sequence whenever introducing a new vertical slice:

### Step 1: Database Schema & Migration
1. Define the table schema in `src/lib/server/db/schema/<feature>.ts`.
   - Use `uuid('id').primaryKey().defaultRandom()`.
   - Spread `...timestamps` from `./_columns.ts` (`precision: 3` and `$onUpdate`).
   - Add explicit foreign keys with `references(() => table.id, { onDelete: 'cascade' })`.
   - Add composite indexes matching anticipated `WHERE ... ORDER BY ...` patterns.
2. Re-export the table from `src/lib/server/db/schema/index.ts`.
3. Generate and verify migration:
   ```bash
   npx drizzle-kit generate
   ```
   Inspect the generated SQL file in `./drizzle/` to ensure no unintended table recreation or column dropping occurs.

### Step 2: Repository
1. Create `src/lib/server/modules/<feature>/<feature>.repository.ts`.
2. Export row types derived via `typeof table.$inferSelect` and insert shapes.
3. Write query methods with an optional trailing `executor: DbExecutor = db` parameter.
4. For user-owned resources, scope queries by `userId` directly in SQL (`findByIdForUser`, `findPageByUser`).
5. Restrict projections to needed columns using explicit select objects.

### Step 3: TypeBox Schemas & DTOs
1. Create `src/lib/server/modules/<feature>/<feature>.schema.ts`.
2. Define boundary validation schemas:
   - Path params (e.g. UUID format).
   - Query filters (derive from `paginationQuerySchema`, use `t.Numeric()` for numbers).
   - Request bodies (set `{ additionalProperties: false }`, bound string lengths).
3. Define response DTO schemas:
   - Summary DTO, Detail DTO, and Paginated Page DTO.
4. Export static TypeScript types via `typeof schema.static`.

### Step 4: Mapper
1. Create `src/lib/server/modules/<feature>/<feature>.mapper.ts`.
2. Write deterministic mapping functions `to<Feature>DetailDto(row)` and `to<Feature>SummaryDto(row)`.
3. Perform Date to ISO-8601 string conversions here.

### Step 5: Service Layer
1. Create `src/lib/server/modules/<feature>/<feature>.service.ts`.
2. Implement business rules, authorization assertions, and domain logic.
3. Import domain errors from `$lib/server/errors/domain-error` and throw `NotFoundError`, `ConflictError`, or `ForbiddenError` where appropriate.
4. If modifying multiple tables, wrap operations in `withTransaction` and pass `tx` to all repository methods.
5. Never import `drizzle-orm`, schema tables, or presentation types in the service.

### Step 6: Route Plugin
1. Create `src/lib/server/modules/<feature>/<feature>.routes.ts`.
2. Create an Elysia instance with `name: '<feature>-routes'` and `prefix: '/<resource>'`.
3. Register `.use(authPlugin)` before protected routes.
4. Set route options:
   - Guard flags (`requireAuth: true` / `requireAdmin: true`).
   - Input validation schemas (`params`, `query`, `body`).
   - Response DTO schemas (`response: { 200: ... }`).
5. Handlers must only forward validated inputs to the service and set HTTP statuses (`201`, `204`).

### Step 7: Module Public API
1. Create `src/lib/server/modules/<feature>/index.ts`.
2. Re-export only the route plugin, service object, and public DTO types. Keep the repository and mapper internal.
3. Register the route plugin in `src/lib/server/api/app.ts`:
   ```ts
   export const api = new Elysia({ prefix: '/api' })
     // ...plugins
     .use(featureRoutes)
   ```

### Step 8: Tests & UI Integration
1. Write unit tests for the service in `<feature>.service.test.ts` (mock repository).
2. Write integration tests in `<feature>.integration.test.ts` against real PostgreSQL (test CRUD, cursor pagination, and IDOR access control).
3. On the frontend, consume endpoints via Eden Treaty `createApiClient()` inside `+page.server.ts` or Svelte 5 components.
4. Run verification commands:
   ```bash
   npm run check
   npm run lint
   npm run test:unit
   npm run test:integration
   ```

---

## Playbook 2: Bootstrap a New Project

Use the automated scaffolder or the checklist below when creating a new TESD stack codebase.

### 0. Automated Scaffolding (Recommended)

To instantiate a complete, production-ready TESD project in seconds without manual file creation:

```bash
node scripts/scaffold-project.js ./my-app --name "my-app"
```

This immediately creates all 60+ canonical files: SvelteKit 2, Svelte 5 runes, Elysia catch-all wiring, Drizzle singleton pool, auth session module with cookies, and bilingual `en`/`id` i18n dictionaries.

---

### 1. Manual Setup Reference & Scripts

Ensure `package.json` includes the canonical scripts expected by verification tooling and CI:

```json
{
  "scripts": {
    "dev": "vite dev",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-check --tsconfig ./tsconfig.json && tsc --noEmit",
    "lint": "eslint .",
    "deps:cycles": "madge --circular src/lib/server",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx scripts/migrate.ts",
    "db:check": "drizzle-kit check",
    "test": "vitest run",
    "test:unit": "vitest run --project unit",
    "test:integration": "vitest run --project integration",
    "test:coverage": "vitest run --coverage"
  }
}
```

### 2. Core Dependencies
- **Core Framework**: `svelte`, `@sveltejs/kit`, `@sveltejs/adapter-node`, `vite`
- **API & Validation**: `elysia`, `@sinclair/typebox`, `@elysiajs/eden`
- **Database**: `drizzle-orm`, `drizzle-kit`, `pg`, `@types/pg`
- **Auth & Crypto**: `@node-rs/argon2`
- **Observability**: `pino`, `pino-pretty` (dev)
- **Tooling & Test**: `typescript`, `eslint`, `vitest`, `madge`, `tsx`, `dotenv`

### 3. Essential Config Files

#### `drizzle.config.ts`
```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/lib/server/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? ''
  },
  strict: true,
  verbose: true
})
```

#### `tsconfig.json` (Compiler Strictness)
```json
{
  "extends": "./.svelte-kit/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "moduleResolution": "bundler"
  }
}
```

---

## Reference Implementation: Post Module

A complete, production-ready implementation of a vertical slice adhering to all TESD rules.

### 1. Schema (`src/lib/server/db/schema/post.ts`)
```ts
import { index, pgEnum, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core'
import { POST_STATUSES } from '$lib/shared/constants/post-status'
import { timestamps } from './_columns'
import { users } from './user'

export const postStatusEnum = pgEnum('post_status', POST_STATUSES)

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 200 }).notNull(),
  content: text('content').notNull(),
  status: postStatusEnum('status').notNull().default('draft'),
  ...timestamps
}, (table) => [
  index('posts_user_created_id_idx').on(table.userId, table.createdAt.desc(), table.id.desc())
])
```

### 2. Validation & DTO Schemas (`src/lib/server/modules/post/post.schema.ts`)
```ts
import { t } from 'elysia'
import { POST_STATUSES } from '$lib/shared/constants/post-status'
import { paginationQuerySchema } from '$lib/server/shared/pagination'

export const postStatusSchema = t.Union(POST_STATUSES.map((s) => t.Literal(s)))

export const postIdParamsSchema = t.Object({
  id: t.String({ format: 'uuid' })
}, { additionalProperties: false })

export const listPostsQuerySchema = paginationQuerySchema

export const createPostBodySchema = t.Object({
  title: t.String({ minLength: 3, maxLength: 200 }),
  content: t.String({ minLength: 1, maxLength: 50_000 }),
  status: t.Optional(postStatusSchema)
}, { additionalProperties: false })

export const updatePostBodySchema = t.Partial(createPostBodySchema, { minProperties: 1, additionalProperties: false })

export const postSummaryDtoSchema = t.Object({
  id: t.String(),
  title: t.String(),
  status: postStatusSchema,
  createdAt: t.String()
})

export const postDetailDtoSchema = t.Composite([
  postSummaryDtoSchema,
  t.Object({ content: t.String() })
])

export const postPageDtoSchema = t.Object({
  items: t.Array(postSummaryDtoSchema),
  nextCursor: t.Union([t.String(), t.Null()])
})

export type ListPostsQuery = typeof listPostsQuerySchema.static
export type CreatePostBody = typeof createPostBodySchema.static
export type UpdatePostBody = typeof updatePostBodySchema.static
export type PostSummaryDto = typeof postSummaryDtoSchema.static
export type PostDetailDto = typeof postDetailDtoSchema.static
export type PostPageDto = typeof postPageDtoSchema.static
```

### 3. Mapper (`src/lib/server/modules/post/post.mapper.ts`)
```ts
import type { PostRow } from './post.repository'
import type { PostDetailDto, PostSummaryDto } from './post.schema'

export function toPostSummaryDto(row: Pick<PostRow, 'id' | 'title' | 'status' | 'createdAt'>): PostSummaryDto {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    createdAt: row.createdAt.toISOString()
  }
}

export function toPostDetailDto(row: PostRow): PostDetailDto {
  return {
    ...toPostSummaryDto(row),
    content: row.content
  }
}
```

### 4. Repository (`src/lib/server/modules/post/post.repository.ts`)
```ts
import { and, desc, eq, sql } from 'drizzle-orm'
import { db, type DbExecutor } from '$lib/server/db'
import { posts } from '$lib/server/db/schema'
import type { Cursor } from '$lib/server/shared/cursor'

export type PostRow = typeof posts.$inferSelect
export type NewPostValues = Pick<typeof posts.$inferInsert, 'title' | 'content' | 'status'>
export type UpdatePostValues = Partial<NewPostValues>

const SUMMARY_COLUMNS = {
  id: posts.id,
  title: posts.title,
  status: posts.status,
  createdAt: posts.createdAt
} as const

export const postRepository = {
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
  },

  async insert(userId: string, values: NewPostValues, executor: DbExecutor = db): Promise<PostRow> {
    const [row] = await executor.insert(posts).values({ ...values, userId }).returning()
    if (!row) throw new Error('Insert failed to return row')
    return row
  },

  async updateForUser(userId: string, postId: string, values: UpdatePostValues, executor: DbExecutor = db): Promise<PostRow | undefined> {
    const [row] = await executor.update(posts).set(values)
      .where(and(eq(posts.id, postId), eq(posts.userId, userId)))
      .returning()
    return row
  },

  async deleteForUser(userId: string, postId: string, executor: DbExecutor = db): Promise<boolean> {
    const rows = await executor.delete(posts)
      .where(and(eq(posts.id, postId), eq(posts.userId, userId)))
      .returning({ id: posts.id })
    return rows.length > 0
  }
}
```

### 5. Service (`src/lib/server/modules/post/post.service.ts`)
```ts
import { NotFoundError } from '$lib/server/errors/domain-error'
import { DEFAULT_PAGE_SIZE } from '$lib/shared/constants/pagination'
import { parseCursor } from '$lib/server/shared/cursor'
import { toPage } from '$lib/server/shared/pagination'
import { postRepository } from './post.repository'
import { toPostDetailDto, toPostSummaryDto } from './post.mapper'
import type { CreatePostBody, ListPostsQuery, PostDetailDto, PostPageDto, UpdatePostBody } from './post.schema'

export const postService = {
  async listByUser(userId: string, query: ListPostsQuery): Promise<PostPageDto> {
    const limit = query.limit ?? DEFAULT_PAGE_SIZE
    const cursor = parseCursor(query.cursor)
    const rows = await postRepository.findPageByUser(userId, { limit, cursor })
    const page = toPage(rows, limit)
    return {
      items: page.items.map(toPostSummaryDto),
      nextCursor: page.nextCursor
    }
  },

  async getById(userId: string, postId: string): Promise<PostDetailDto> {
    const row = await postRepository.findByIdForUser(userId, postId)
    if (!row) throw new NotFoundError('Post not found')
    return toPostDetailDto(row)
  },

  async create(userId: string, input: CreatePostBody): Promise<PostDetailDto> {
    const row = await postRepository.insert(userId, {
      title: input.title,
      content: input.content,
      status: input.status ?? 'draft'
    })
    return toPostDetailDto(row)
  },

  async update(userId: string, postId: string, input: UpdatePostBody): Promise<PostDetailDto> {
    const row = await postRepository.updateForUser(userId, postId, input)
    if (!row) throw new NotFoundError('Post not found')
    return toPostDetailDto(row)
  },

  async remove(userId: string, postId: string): Promise<void> {
    const deleted = await postRepository.deleteForUser(userId, postId)
    if (!deleted) throw new NotFoundError('Post not found')
  }
}
```

### 6. Routes (`src/lib/server/modules/post/post.routes.ts`)
```ts
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

### 7. Module Index (`src/lib/server/modules/post/index.ts`)
```ts
export { postRoutes } from './post.routes'
export { postService } from './post.service'
export type { PostDetailDto, PostSummaryDto, PostPageDto } from './post.schema'
```

### 8. Unit Tests (`src/lib/server/modules/post/post.service.test.ts`)
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '$lib/server/errors/domain-error'
import { postRepository } from './post.repository'
import { postService } from './post.service'

vi.mock('./post.repository')

describe('postService.getById', () => {
  beforeEach(() => vi.resetAllMocks())

  it('throws NotFoundError when post does not belong to user or does not exist', async () => {
    vi.mocked(postRepository.findByIdForUser).mockResolvedValue(undefined)
    await expect(postService.getById('u-1', 'p-1')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('returns mapped DTO on success', async () => {
    vi.mocked(postRepository.findByIdForUser).mockResolvedValue({
      id: 'p-1',
      userId: 'u-1',
      title: 'Title',
      content: 'Content',
      status: 'draft',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z')
    })

    const res = await postService.getById('u-1', 'p-1')
    expect(res).toEqual({
      id: 'p-1',
      title: 'Title',
      content: 'Content',
      status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z'
    })
  })
})
```

### 9. Integration & Security Tests (`src/lib/server/modules/post/post.integration.test.ts`)
```ts
import { describe, expect, it } from 'vitest'
import { apiRequest, createTestUser } from '$tests/helpers/api'

describe('post module integration & authorization', () => {
  it('enforces authentication on all endpoints', async () => {
    expect((await apiRequest('/posts')).status).toBe(401)
    expect((await apiRequest('/posts', { method: 'POST', body: { title: 'a', content: 'b' } })).status).toBe(401)
  })

  it('prevents IDOR: accessing another user post returns 404', async () => {
    const owner = await createTestUser()
    const attacker = await createTestUser()

    const createdRes = await apiRequest('/posts', {
      method: 'POST',
      token: owner.token,
      body: { title: 'Secret Post', content: 'Owner eyes only' }
    })
    const created = await createdRes.json()

    // Attacker gets 404, keeping resource existence private
    expect((await apiRequest(`/posts/${created.id}`, { token: attacker.token })).status).toBe(404)
    expect((await apiRequest(`/posts/${created.id}`, { method: 'DELETE', token: attacker.token })).status).toBe(404)

    // Owner succeeds
    expect((await apiRequest(`/posts/${created.id}`, { token: owner.token })).status).toBe(200)
  })
})
```
