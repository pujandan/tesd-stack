# Code Quality — English Only, Naming, TypeScript, Svelte 5, DRY, Tooling

How code reads, not just how it runs. These rules make a large codebase look like it was written by one careful team.

## Contents

- [English-Only Rule](#english-only-rule)
- [Naming Conventions](#naming-conventions)
- [TypeScript Rules](#typescript-rules)
- [Svelte 5 Rules](#svelte-5-rules)
- [DRY — Zero Redundancy](#dry--zero-redundancy)
- [Function and File Hygiene](#function-and-file-hygiene)
- [Comments](#comments)
- [Tooling That Enforces This](#tooling-that-enforces-this)
- [Incorrect / Correct](#incorrect--correct)

## English-Only Rule

**All code artifacts are written in English, with no exceptions.** Replying to the user in their own language is fine; producing non-English code artifacts is not.

| Artifact | Rule | Example |
|---|---|---|
| Identifiers | English | `totalPrice`, NOT `totalHarga` |
| Comments | English; explain WHY, not WHAT | `// Retry once: the pool drops idle connections after 30s` |
| Error messages | English, user-comprehensible | `'Email already registered'` |
| API codes/keys | English SCREAMING_SNAKE for codes | `{ error: { code: 'NOT_FOUND' } }` |
| Commit messages | English, imperative, Conventional Commits | `feat(post): add cursor pagination` |
| Branch names | English kebab-case | `feat/post-pagination` |
| Docs / README / ADRs | English | — |
| Test names | English, behavior-first | `it('returns 404 when the post belongs to another user')` |

Why (for the agent): mixed-language identifiers break search, review, and tooling; API consumers parse English codes; maintainers (human or AI) must not need a translation layer. User-facing UI copy in other languages belongs in type-safe dictionaries under `src/lib/shared/i18n/` with a dual-locale minimum (`en`/`xx`), never in logic or identifiers. See [i18n-locale.md](./i18n-locale.md).

**Writing style for AI-readable code:** use full words, one concept per name, no slang or abbreviations, no clever wordplay, and explicit units in names for quantities (`timeoutMs`, `ttlSeconds`, `maxBytes`).

## Naming Conventions

| Item | Convention | Example |
|---|---|---|
| Files (non-Svelte) | kebab-case with role suffix | `post.service.ts`, `rate-limit.plugin.ts` |
| Svelte components | PascalCase | `PostCard.svelte` |
| Route plugin export | camelCase + `Routes` | `postRoutes` |
| Service / Repository export | camelCase + `Service` / `Repository` | `postService`, `postRepository` |
| Mapper functions | `to<Thing>Dto` | `toPostSummaryDto` |
| TypeBox schema export | camelCase + `Schema` | `createPostBodySchema`, `postDetailDtoSchema` |
| Static types from schemas | PascalCase, `Body`/`Query`/`Dto` suffix | `CreatePostBody`, `PostDetailDto` |
| Functions / variables | camelCase, verb-first | `getUserById`, `isExpired` |
| Booleans | `is` / `has` / `can` prefix | `isPublished`, `hasAccess` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_PAGE_SIZE` |
| Types / interfaces | PascalCase, no `I` prefix | `AuthUser` |
| Domain errors | PascalCase + `Error` | `NotFoundError` |
| DB tables | snake_case, plural | `users`, `order_items` |
| DB columns | snake_case | `created_at`, `password_hash` |
| DB indexes | `<table>_<cols>_idx` (`_chk` for checks) | `posts_user_created_id_idx` |
| Tests | `<file>.test.ts` / `<feature>.integration.test.ts` | `post.service.test.ts` |

Rules:

1. **Names say what a thing IS**, not how it is stored (`passwordHash`, not `pw_sha`).
2. **No abbreviations** except `id`, `url`, `db`, `tx`, `env`, `dto`. Not `cfg`, `usr`, `msg`.
3. **One concept, one verb project-wide.** Reads: `get` (throws if missing) / `find` (returns nullable) / `list` (collection). Writes: `create`, `update`, `remove`. Repositories use `find…`/`insert`/`update…`/`delete…`; services use `get…`/`list…`/`create`/`update`/`remove`.
4. Service methods that act on user-owned data take `userId` first.

## TypeScript Rules

1. **`strict: true` and `noUncheckedIndexedAccess: true`** in tsconfig. Also `noImplicitOverride`, `noFallthroughCasesInSwitch`. Explicitly exclude build artifacts (`"exclude": ["node_modules", ".svelte-kit/output", "build"]`) to prevent `svelte-check` false-positive type scans on compiled bundles. Configure path aliases for Node subpath imports (`#lib/*` and `$lib/*`) and mock virtual modules (`$app/*`, `$env/*`).
2. **`any` is forbidden.** Use `unknown` and narrow, or a precise type. `@ts-ignore` is forbidden; `@ts-expect-error` requires a comment with the reason and an issue reference.
3. **No `as` casts on untrusted data.** Validate with a schema or narrow with a type guard. `as const` and `satisfies` are fine; a cast after a validated schema is not needed.
4. **Prefer inference for locals; annotate boundaries:** function signatures, exports, and public APIs.
5. **`satisfies` over `as`** to check a literal against a type while keeping inference.
6. **Discriminated unions for states:**

```ts
type LoadState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string }
```

7. **`readonly` / `as const`** for config maps, constant arrays, and enumerations (they feed `pgEnum` and TypeBox).
8. **No type-level duplication:** rows from `$inferSelect`, requests/responses from `typeof schema.static`.
9. **Explicit, minimal exports:** one purpose per module; **no `export *`** (module `index.ts` files re-export named symbols).
10. `import type` for type-only imports (`verbatimModuleSyntax`).

## Svelte 5 Rules

1. **Runes** for all reactive state: `$state`, `$derived`, `$props`, `$effect`. No `writable()` stores in new code.
2. **Typed props:**

```svelte
<script lang="ts">
  import type { PostSummaryDto } from '$lib/server/modules/post'   // type-only: erased at build, allowed
  interface Props { post: PostSummaryDto; onDelete?: (id: string) => void }
  let { post, onDelete }: Props = $props()
</script>
```

3. **`$effect` is for DOM/external synchronization only.** Derive state with `$derived`.
4. **Event handlers are properties:** `onclick={handle}`, not `on:click`.
5. **Components are presentation-only.** Data comes from `load` props or the Eden client; components never import `$lib/server`.
6. **Client code may use `import type` from a module root** (DTO types, `Api`) because type imports are erased at build. A runtime (non-type) import of `$lib/server` is always a violation; `consistent-type-imports` keeps the distinction explicit.
7. **Accessibility is code quality:** labels on inputs, `alt` on images, keyboard focus preserved. Fix Svelte a11y warnings; never mute them without a comment.
8. A component over ~250 lines or with more than one data source gets split.

## DRY — Zero Redundancy

1. **One source of truth per concept:**
   - Table shape → Drizzle schema (types inferred)
   - Request/response shape → TypeBox schema (types inferred)
   - Enumerations (roles, statuses) → `$lib/shared/constants` (used by `pgEnum`, TypeBox, UI)
   - Auth checks → guard macros
   - Error envelope → the error plugin
   - Pagination (cursor, page trimming, limits) → `shared/cursor.ts`, `shared/pagination.ts`
   - Timestamp columns → `schema/_columns.ts`
   - Environment → `env.ts`
2. **Extract on the second duplicate** when the shape is genuinely identical; the third occurrence must not exist.
3. **Extract by abstraction level:** HTTP helper for HTTP, service method for domain logic, pure util for pure logic. A helper that mixes levels (builds SQL AND parses JSON) is wrong.
4. **Shared UI** lives in `src/lib/components/`: three similar markup blocks become one component.
5. **No speculative abstraction.** Two similar-but-drifting pieces are not one parameterized mega-function; duplicate until the real common shape emerges.
6. **Documentation is DRY too:** put a pattern in one place and link to it.

## Function and File Hygiene

1. A function does one thing and is named by what it does (`parseCursor`, `assertCanPublish`, not `handleData`).
2. **Early returns** over nesting; no `else` after `return`.
3. **Smell thresholds:** function > 40 lines, file > 400 lines (service/repository), route file > 150 lines, component > 250 lines, > 4 parameters (use an options object), cyclomatic complexity > 10.
4. **No dead code:** unused exports, unreachable branches, commented-out blocks, debug `console.log` — deleted. Git remembers.
5. No unused imports/variables. **No unused parameters kept "for later"**.
6. **No `console.*` in server code** — use `logger`. (Scripts may print.)
7. One export focus per file (`post.service.ts` exports `postService`); nothing exported "for later".
8. **Immutability by default:** `const`, `readonly`, non-mutating array methods (`toSorted`, `map`) when practical.

## Comments

1. Comments explain **WHY**; code explains WHAT. `// Fetch user` above `getUser()` is noise; `// Cache 60s: the profile API rate-limits per minute` is signal.
2. Document **non-obvious constraints**: units, invariants, security reasons, workarounds with links.
3. **No change-log comments** (`// fixed bug`). History lives in git.
4. **TODOs need an owner and an issue:** `// TODO(<owner>): remove fallback after migration #42`. A bare `// TODO` is forbidden.
5. Public service/repository methods get a one-line JSDoc only when the contract is not obvious from the name and types (e.g. "returns limit + 1 rows").
6. English only.

## Tooling That Enforces This

Rules that are not automated drift. Every TESD project ships with:

- **TypeScript** strict flags above, checked by `npm run check` (`svelte-check --tsconfig ./tsconfig.json` + `tsc --noEmit`).
- **ESLint** with `typescript-eslint` `strictTypeChecked` + `stylisticTypeChecked`, `eslint-plugin-svelte`, `no-console` (server code), and the boundary rules from [architecture.md](./architecture.md#enforcing-the-rules-with-eslint). Key rules: `@typescript-eslint/no-explicit-any`, `no-unsafe-*`, `no-floating-promises`, `consistent-type-imports`, `no-restricted-imports`.
- **Prettier** (+ `prettier-plugin-svelte`) — formatting is never discussed in review.
- **Conventional Commits** (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`) with scope = module name; optional `commitlint` + Husky/lefthook.
- **CI** runs every command in [SKILL.md](../SKILL.md#verification-commands) and blocks merge on failure.

## Incorrect / Correct

**Incorrect — non-English, `any`, nesting, duplication, dead code, JS aggregation:**

```ts
// ambil data harga utk user
export const getPricingData = async (user: any, opts?: any) => {
  if (user) {
    if (opts && opts.includeTax) {
      // const OLD_LOGIC = calculateLegacyPrice(user)  // jangan dipakai lagi
      const harga = await db.select().from(prices).where(eq(prices.userId, user.id))
      return { data: harga, total: harga.reduce((a: any, b: any) => a + b.amount, 0) }
    } else {
      const harga = await db.select().from(prices).where(eq(prices.userId, user.id))
      return { data: harga, total: harga.reduce((a: any, b: any) => a + b.amount, 0) }
    }
  } else {
    throw new Error('user tidak ada')
  }
}
```

**Correct — repository aggregates in SQL; service stays flat and typed:**

```ts
// price.repository.ts
const TOTAL_CENTS = sql<string>`coalesce(sum(${prices.amountCents}), 0)`   // sum() returns text in PostgreSQL

export const priceRepository = {
  async sumCentsForUser(userId: string, executor: DbExecutor = db): Promise<number> {
    const [row] = await executor.select({ total: TOTAL_CENTS }).from(prices).where(eq(prices.userId, userId))
    return Number(row?.total ?? 0)
  }
}

// price.service.ts
export const priceService = {
  async getTotal(userId: string): Promise<{ totalCents: number }> {
    return { totalCents: await priceRepository.sumCentsForUser(userId) }
  }
}
```

What changed: English names; no `any`; both identical branches collapsed; the aggregation moved into SQL instead of loading rows to sum in JS; money in integer cents; no unused option parameter; dead commented code deleted; "no user" is impossible by construction because routes pass `user.id` from the guard. 19 nested lines became 8 flat ones — that ratio is the goal.
