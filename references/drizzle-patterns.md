# Drizzle Patterns — Schema, Optimal Queries, Pagination, Migrations

Data layer rules for Drizzle ORM + PostgreSQL via `drizzle-orm/node-postgres`. Only **repositories** import Drizzle ([architecture.md](./architecture.md#dependency-rules)). The client/pool/transaction helper is in [design-patterns.md §6](./design-patterns.md#6-singleton-db-client--transaction-helper).

## Contents

- [Schema Conventions](#schema-conventions)
- [Query API: select vs query](#query-api-select-vs-query)
- [Type Inference](#type-inference)
- [Query Optimization Rules](#query-optimization-rules)
- [Pagination](#pagination)
- [Search](#search)
- [Transactions](#transactions)
- [Migration Workflow](#migration-workflow)
- [Incorrect / Correct](#incorrect--correct)

## Schema Conventions

```ts
// src/lib/server/db/schema/_columns.ts — shared column helpers (DRY)
import { timestamp } from 'drizzle-orm/pg-core'

// precision: 3 keeps DB values at millisecond resolution so they round-trip exactly through JS Date.
// Without it, keyset cursors compare microsecond DB values with millisecond JS values and skip/duplicate rows.
const timestampColumn = (name: string) => timestamp(name, { withTimezone: true, precision: 3 })

export const timestamps = {
  createdAt: timestampColumn('created_at').notNull().defaultNow(),
  updatedAt: timestampColumn('updated_at').notNull().defaultNow().$onUpdate(() => new Date())
}
export { timestampColumn }
```

```ts
// src/lib/server/db/schema/user.ts
import { check, pgEnum, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { ROLES } from '$lib/shared/constants/roles'
import { timestamps } from './_columns'

export const userRoleEnum = pgEnum('user_role', ROLES)   // values come from one shared constant

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  role: userRoleEnum('role').notNull().default('user'),
  ...timestamps
}, (table) => [
  // Emails are normalized to lowercase in one function; the database enforces it.
  check('users_email_lowercase_chk', sql`${table.email} = lower(${table.email})`)
])
```

```ts
// src/lib/server/db/schema/post.ts
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
  // Serves: WHERE user_id = ? ORDER BY created_at DESC, id DESC (keyset pagination).
  // Its prefix also covers lookups by user_id alone, so NO separate user_id index.
  index('posts_user_created_id_idx').on(table.userId, table.createdAt.desc(), table.id.desc())
])
```

Mandatory rules:

1. **Primary keys:** `uuid('id').primaryKey().defaultRandom()`. (UUIDv7, e.g. PostgreSQL 18 `uuidv7()`, is an acceptable upgrade for write-heavy tables: better index locality.)
2. **DB names are snake_case; TS properties are camelCase.** The column-name string is always explicit.
3. **Timestamps:** `timestamp({ withTimezone: true, precision: 3 })` via the shared `timestamps` helper; `updatedAt` uses `$onUpdate`.
4. **Every FK declares `references()` with an explicit `onDelete`** (`cascade`, `set null`, or `restrict`), chosen on purpose.
5. **Index every FK that is joined or filtered on** — PostgreSQL does not index FKs automatically. A FK column already covered by the leading column of a composite index needs no extra index; **redundant prefix indexes are defects** (extra write cost, zero read benefit).
6. **Enums:** `pgEnum` with values from `src/lib/shared/constants/*` so DB, validation, and UI share one definition.
7. **Constraints belong in the database** (`unique`, `notNull`, `check`), not only in application code.
8. **Money:** integer minor units (`integer`/`bigint` cents) or `numeric(precision, scale)`; never `real`/`double`.
9. **One file per table** in `schema/`, re-exported from `schema/index.ts`.
10. **Never edit an applied migration.** Schema changes always create a new migration.

## Query API: select vs query

1. **`db.select()` (query builder) is the default** for lists, writes, aggregates, joins, and anything performance-sensitive: exact SQL, exact columns, exact index usage.
2. **`db.query` (relational API)** is allowed only for read-only nested trees (post + author + comments on a detail screen). Never for paginated lists or hot paths.

## Type Inference

Types come from the schema. Export them from the repository:

```ts
export type PostRow = typeof posts.$inferSelect
export type NewPostValues = Pick<typeof posts.$inferInsert, 'title' | 'content' | 'status'>
```

For partial selects the query's own select shape is the type (`{ id: string; title: string }[]`). If you ever write `interface PostRow { id: string; … }` that mirrors a table, delete it.

### Strict Union Typing on Varchar Columns (`.$type<T>()`)

By default, `varchar` or `text` columns are inferred by Drizzle as generic `string`. When mapping database rows to TypeBox DTO schemas in Elysia routes (e.g. `t.Union([t.Literal('draft'), t.Literal('reviewed'), t.Literal('final')])`), this causes TypeScript compiler errors without an unsafe manual type cast (`as`).

Use Drizzle's `.$type<Union>()` chained directly on the column definition:

```ts
export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 200 }).notNull(),
  status: varchar('status', { length: 20 })
    .notNull()
    .default('draft')
    .$type<'draft' | 'reviewed' | 'final'>(),
  ...timestamps
})
```

Benefits:
1. `posts.$inferSelect` yields `status: 'draft' | 'reviewed' | 'final'` instead of generic `string`.
2. Seamless, type-safe mapping to TypeBox DTO response schemas with zero manual casting.
3. Compile-time enforcement on all repository inserts and updates.

## Query Optimization Rules

1. **Select only the columns you use.** `select()` with no arguments is allowed only when every column is consumed (detail views).

```ts
// WRONG: pulls every column (including large text) for a list
const rows = await executor.select().from(posts).where(eq(posts.userId, userId))

// RIGHT: exactly what the list renders
const rows = await executor
  .select({ id: posts.id, title: posts.title, status: posts.status, createdAt: posts.createdAt })
  .from(posts).where(eq(posts.userId, userId))
```

2. **Never query inside a loop.** Batch with `inArray` or join.

```ts
// WRONG: N+1
for (const post of rows) await executor.select().from(users).where(eq(users.id, post.userId))

// RIGHT: one query
const authors = await executor.select({ id: users.id, name: users.name }).from(users)
  .where(inArray(users.id, [...new Set(rows.map((row) => row.userId))]))
```

3. **Join when it beats two round-trips** (one `innerJoin` for a single list); use `inArray` when ids are already in memory.
4. **Always `LIMIT`.** Every list query has a limit; the validation layer caps it (`maximum: 50`).
5. **Existence checks select one indexed column with `limit(1)`**, not `count(*)`.
6. **Filter, sort, aggregate in SQL**, never in JavaScript. Aggregations (`sum`, `count`) belong in the query; `sum()` returns text in PostgreSQL, so type it `sql<string>` and convert.
7. **Bulk writes are single statements** (`insert().values([...])`, `update … where inArray`), not loops.
8. **Atomic conditional writes** instead of read-then-write:

```ts
// Reserve stock atomically; the WHERE guard prevents overselling under concurrency.
const updated = await executor.update(products)
  .set({ stock: sql`${products.stock} - ${qty}` })
  .where(and(eq(products.id, productId), gte(products.stock, qty)))
  .returning({ id: products.id })
const reserved = updated.length > 0
```

9. **Check hot queries with `EXPLAIN (ANALYZE, BUFFERS)`.** Any list/per-request query on a growing table must use an index (no `Seq Scan`). Enable Drizzle `logger: true` in development only.
10. **Parameterize everything.** The query builder always parameterizes. `sql` templates may interpolate columns and `${value}` parameters only ([security.md](./security.md#sql-injection)).
11. **Concurrency-safe uniqueness:** use `onConflictDoNothing({ target })` / `onConflictDoUpdate` and check `.returning()`, instead of "select then insert".

## Pagination

**Keyset (cursor) pagination is the default** for all user-facing lists. It is stable under concurrent writes and constant-time per page with the composite index.

Use a **row-value comparison**, which PostgreSQL can serve with a single index range scan (the `OR (…) AND (…)` expansion is slower and can fall back to a bitmap scan):

```ts
// post.repository.ts
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
    .orderBy(desc(posts.createdAt), desc(posts.id))   // total order: id breaks timestamp ties
    .limit(page.limit + 1)                            // probe row detects a next page
}
```

The service trims the page with `toPage(rows, limit)` and maps DTOs ([design-patterns.md §11](./design-patterns.md#11-factory-cursor--pagination)); the cursor is built from the **raw row** (a `Date`), not from the DTO string.

Rules:

1. Sort direction of the row-value comparison must match the index (`DESC, DESC` ↔ `<`).
2. **Offset pagination** is acceptable only for small admin tables, with a hard cap on `offset`; never for feeds.
3. Return `{ items, nextCursor }`. Add `COUNT(*)` totals only when the UI truly needs them (expensive on large tables; cache if so).
4. Malformed cursors are rejected by `parseCursor` (400), never forwarded to PostgreSQL.

## Search

`ilike '%term%'` cannot use a btree index (sequential scan) and treats `%`/`_` in user input as wildcards. Required approach:

```ts
// Escape LIKE metacharacters in user input (default escape character is backslash)
const escapeLike = (term: string) => term.replace(/[\\%_]/g, '\\$&')

.where(ilike(posts.title, `%${escapeLike(term)}%`))
```

and back it with a trigram index for any table expected to exceed ~10k rows:

```ts
// schema: GIN trigram index (requires `CREATE EXTENSION IF NOT EXISTS pg_trgm;` in a custom migration)
index('posts_title_trgm_idx').using('gin', table.title.op('gin_trgm_ops'))
```

For linguistic search, use PostgreSQL full-text search (`to_tsvector`/`websearch_to_tsquery` with a GIN index). Search inputs also get `maxLength` in the schema.

## Transactions

```ts
return withTransaction(async (tx) => {
  const order = await orderRepository.insert(userId, input, tx)
  await orderRepository.insertItems(order.id, input.items, tx)
  return order.id
})
```

Rules:

1. Orchestrate in the **service** with `withTransaction`; repositories only receive `tx` as their last argument ([design-patterns.md §9](./design-patterns.md#9-unit-of-work-transaction)).
2. Every statement inside uses `tx`.
3. Short transactions: database work only; no HTTP/email/event emits inside.
4. Throw to roll back; never swallow errors inside the callback.
5. Map PostgreSQL unique violations (`23505`) with `onConflictDoNothing` where possible. When you must catch a driver error, use `isUniqueViolation(err)` from `$lib/server/db/errors.ts` (it inspects `err.code` and `err.cause.code`, because Drizzle wraps driver errors) **inside the repository**, and return a value — never leak driver errors upward.

```ts
// src/lib/server/db/errors.ts
function readCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  if ('code' in error && typeof error.code === 'string') return error.code
  return 'cause' in error ? readCode(error.cause) : undefined
}
export const isUniqueViolation = (error: unknown): boolean => readCode(error) === '23505'
```

## Migration Workflow

```bash
npm run db:generate   # drizzle-kit generate → ./drizzle/NNNN_*.sql — READ the SQL before committing
npm run db:migrate    # apply locally (tsx scripts/migrate.ts)
npm run db:check      # drizzle-kit check: verifies migration history consistency (CI gate)
```

Rules:

1. **`generate` + migrate everywhere.** `drizzle-kit push` only against throwaway local databases, never staging/production.
2. **Read every generated migration.** Flag anything destructive (`DROP`, `ALTER COLUMN TYPE`, dropping `NOT NULL`) to the user.
3. **Migrations are committed.** Production applies them with `scripts/migrate.ts` (Drizzle's migrator) as a **single separate deploy step**, not at app boot on every replica.
4. **Fix forward.** Never edit an applied migration.
5. **Expand → backfill → contract** for destructive changes on live tables (add nullable column → deploy code writing both → backfill → enforce/remove old). Never rename or retype in one step.
6. Extensions (`pg_trgm`, `citext`) are created in a custom migration (`drizzle-kit generate --custom`).
7. Index creation on large live tables: use `CREATE INDEX CONCURRENTLY` in a custom migration.

## Incorrect / Correct

**Incorrect — the classics in one handler:**

```ts
const all = await db.select().from(posts)                          // 1. select-all
const mine = all.filter((p) => p.userId === user.id)               // 2. filter in JS
mine.sort((a, b) => +b.createdAt - +a.createdAt)                   // 3. sort in JS
for (const p of mine) {                                            // 4. N+1
  const [a] = await db.select().from(users).where(eq(users.id, p.userId))
  out.push({ ...p, authorName: a.name })                           // 5. raw row spread out
}
return out                                                         // 6. no limit
```

**Correct — one indexed, scoped, bounded query inside the repository:**

```ts
executor
  .select({ id: posts.id, title: posts.title, createdAt: posts.createdAt, authorName: users.name })
  .from(posts)
  .innerJoin(users, eq(users.id, posts.userId))
  .where(eq(posts.userId, userId))
  .orderBy(desc(posts.createdAt), desc(posts.id))
  .limit(limit + 1)
```
