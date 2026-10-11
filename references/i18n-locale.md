# Internationalization & Locale — Multi-Language Web & API Flow

How multi-language projects handle localization in the TESD stack without violating Clean Architecture. All internal code artifacts and API error codes remain strictly English ([code-quality.md](./code-quality.md)), while user-facing copy, content, and dates adapt to the requested locale.

Every project requiring localization must support at least two locales: **English (`en`)** as the universal fallback and the **primary target locale** (e.g. Indonesian `id`, or project-specific `xx`).

---

## Contents

- [The Core Separation Principle](#the-core-separation-principle)
- [Directory Structure](#directory-structure)
- [Type-Safe Dictionaries](#type-safe-dictionaries)
- [SvelteKit SSR & Web Flow](#sveltekit-ssr--web-flow)
- [API Contract & Error Mapping](#api-contract--error-mapping)
- [Database Content Localization](#database-content-localization)
- [Locale Switching Endpoint](#locale-switching-endpoint)
- [Rules & Guidelines](#rules--guidelines)
- [Incorrect / Correct](#incorrect--correct)

---

## The Core Separation Principle

1. **API contracts are language-agnostic:** API responses return data and machine-readable English codes (e.g. `{ error: { code: 'NOT_FOUND', message: 'Post not found' } }`). The server does not translate domain error codes into arbitrary human languages inside business services.
2. **The presentation boundary owns translation:** SvelteKit SSR load functions and UI components map machine error codes and domain tokens into localized copy using shared dictionaries.
3. **Dual-locale minimum:** Projects configure `SUPPORTED_LOCALES = ['en', 'id'] as const` (or project equivalent). English is always the fallback if a key or locale is missing.

---

## Directory Structure

```text
src/
├── lib/
│   ├── shared/
│   │   └── i18n/                          # Isomorphic: safe for browser and server
│   │       ├── index.ts                   # t() translator, type definitions, helpers
│   │       ├── locales.ts                 # Supported locales & constants
│   │       ├── dictionaries/
│   │       │   ├── en.ts                  # English (Source of Truth schema)
│   │       │   └── id.ts                  # Indonesian (strictly typed to match en)
│   │       └── errors.ts                  # Machine code -> UI message mapping
│   └── server/
│       └── api/plugins/
│           └── locale.plugin.ts           # Optional: derives locale from Accept-Language for content
```

---

## Type-Safe Dictionaries

The English dictionary is the canonical contract. All other language dictionaries (`id.ts`, `es.ts`, etc.) must satisfy the exact type of the English dictionary.

```ts
// src/lib/shared/i18n/locales.ts
export const SUPPORTED_LOCALES = ['en', 'id'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = 'en'

export function isSupportedLocale(value: string | undefined): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}
```

```ts
// src/lib/shared/i18n/dictionaries/en.ts
export const en = {
  common: {
    appName: 'TESD Application',
    save: 'Save',
    cancel: 'Cancel',
    loading: 'Loading...',
    actions: 'Actions'
  },
  auth: {
    loginTitle: 'Sign In',
    registerTitle: 'Create an Account',
    logout: 'Log Out',
    emailLabel: 'Email Address',
    passwordLabel: 'Password'
  },
  errors: {
    BAD_REQUEST: 'The submitted request is invalid.',
    UNAUTHORIZED: 'You must be logged in to perform this action.',
    FORBIDDEN: 'You do not have permission to access this resource.',
    NOT_FOUND: 'The requested resource was not found.',
    CONFLICT: 'This resource already exists.',
    VALIDATION_ERROR: 'Please check your inputs and try again.',
    RATE_LIMITED: 'Too many requests. Please wait before trying again.',
    INTERNAL: 'An unexpected server error occurred. Please try again later.'
  }
} as const

export type Dictionary = typeof en
```

```ts
// src/lib/shared/i18n/dictionaries/id.ts
import type { Dictionary } from './en'

// `satisfies Dictionary` enforces that all keys are translated without typos or omissions.
export const id = {
  common: {
    appName: 'Aplikasi TESD',
    save: 'Simpan',
    cancel: 'Batal',
    loading: 'Memuat...',
    actions: 'Aksi'
  },
  auth: {
    loginTitle: 'Masuk',
    registerTitle: 'Daftar Akun Baru',
    logout: 'Keluar',
    emailLabel: 'Alamat Email',
    passwordLabel: 'Kata Sandi'
  },
  errors: {
    BAD_REQUEST: 'Permintaan yang dikirimkan tidak valid.',
    UNAUTHORIZED: 'Anda harus masuk terlebih dahulu untuk melakukan aksi ini.',
    FORBIDDEN: 'Anda tidak memiliki izin untuk mengakses sumber daya ini.',
    NOT_FOUND: 'Data yang dicari tidak ditemukan.',
    CONFLICT: 'Data sudah ada sebelumnya.',
    VALIDATION_ERROR: 'Mohon periksa kembali input Anda dan coba lagi.',
    RATE_LIMITED: 'Terlalu banyak permintaan. Silakan tunggu beberapa saat.',
    INTERNAL: 'Terjadi kesalahan pada server. Silakan coba kembali nanti.'
  }
} as const satisfies Dictionary
```

```ts
// src/lib/shared/i18n/index.ts
import { en, type Dictionary } from './dictionaries/en'
import { id } from './dictionaries/id'
import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from './locales'

const DICTIONARIES: Record<Locale, Dictionary> = { en, id }

/** Retrieve a dictionary, falling back to English if the requested locale is unknown. */
export function getDictionary(locale: Locale = DEFAULT_LOCALE): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE]
}

/** Translate a machine error code into a user-facing localized string. */
export function translateErrorCode(code: string, locale: Locale): string {
  const dict = getDictionary(locale)
  return (dict.errors as Record<string, string>)[code] ?? dict.errors.INTERNAL
}

export * from './locales'
export type { Dictionary }
```

---

## SvelteKit SSR & Web Flow

The locale is resolved on every request in `hooks.server.ts` through a 3-step priority fallback:
1. **Cookie** (`locale`): Explicit user selection in the UI.
2. **Header** (`Accept-Language`): Browser preference.
3. **Default**: `DEFAULT_LOCALE` (`en` or configured default).

```ts
// src/hooks.server.ts (addition)
import type { Handle } from '@sveltejs/kit'
import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from '$lib/shared/i18n'

export const LOCALE_COOKIE_NAME = 'locale'

function resolveLocale(cookies: { get: (name: string) => string | undefined }, acceptLanguageHeader: string | null): Locale {
  const cookieValue = cookies.get(LOCALE_COOKIE_NAME)
  if (isSupportedLocale(cookieValue)) return cookieValue

  if (acceptLanguageHeader) {
    const preferred = acceptLanguageHeader.split(',').map((part) => part.split(';')[0]?.trim().toLowerCase())
    for (const lang of preferred) {
      if (!lang) continue
      const prefix = lang.slice(0, 2)
      if (isSupportedLocale(prefix)) return prefix
    }
  }

  return DEFAULT_LOCALE
}

export const localeBridge: Handle = async ({ event, resolve }) => {
  const locale = resolveLocale(event.cookies, event.request.headers.get('accept-language'))
  event.locals.locale = locale

  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%lang%', locale)
  })
}
```

```ts
// src/app.d.ts
import type { AuthUser } from '$lib/server/modules/session'
import type { Locale } from '$lib/shared/i18n'

declare global {
  namespace App {
    interface Locals {
      user: AuthUser | null
      locale: Locale
    }
  }
}
export {}
```

```ts
// src/routes/+layout.server.ts
import type { LayoutServerLoad } from './$types'

export const load: LayoutServerLoad = ({ locals }) => {
  return {
    locale: locals.locale
  }
}
```

---

## API Contract & Error Mapping

Elysia routes continue to return typed domain errors (`{ error: { code, message, requestId } }`). The client or SvelteKit SSR load function translates the `code`:

```svelte
<!-- src/routes/(app)/posts/+page.svelte -->
<script lang="ts">
  import { getDictionary, translateErrorCode } from '$lib/shared/i18n'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()
  let t = $derived(getDictionary(data.locale))
  let errorMessage = $state<string | null>(null)

  function handleApiFailure(errorCode: string) {
    errorMessage = translateErrorCode(errorCode, data.locale)
  }
</script>

<h1>{t.common.appName}</h1>
{#if errorMessage}
  <div class="alert alert-error">{errorMessage}</div>
{/if}
```

---

## Database Content Localization

When database rows contain multi-lingual content (e.g. articles or products), use one of two canonical patterns:

### Pattern A: `jsonb` Column (Small to Medium Datasets)

```ts
// src/lib/server/db/schema/post.ts
import { jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'

export interface LocalizedString {
  en: string
  id?: string
  [key: string]: string | undefined
}

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: jsonb('title').$type<LocalizedString>().notNull(),
  content: jsonb('content').$type<LocalizedString>().notNull()
  // ...timestamps
})
```

Helper for extracting content with English fallback:
```ts
export function pickLocalized(field: LocalizedString, locale: Locale): string {
  return field[locale] ?? field.en ?? ''
}
```

### Pattern B: Translation Table (High-Scale & Searchable)

Separate base entity from translations (`posts` and `post_translations` with `(post_id, locale)` as composite primary key).

---

## Locale Switching Endpoint

Provide a dedicated endpoint to allow users to switch their preferred language:

```ts
// src/routes/api/locale/+server.ts
import { json, type RequestHandler } from '@sveltejs/kit'
import { isSupportedLocale } from '$lib/shared/i18n'
import { LOCALE_COOKIE_NAME } from '../../hooks.server'

export const POST: RequestHandler = async ({ request, cookies }) => {
  const { locale } = await request.json()
  if (!isSupportedLocale(locale)) {
    return json({ error: 'Unsupported locale' }, { status: 400 })
  }

  cookies.set(LOCALE_COOKIE_NAME, locale, {
    path: '/',
    maxAge: 365 * 24 * 60 * 60, // 1 year
    sameSite: 'lax',
    httpOnly: false             // Readable by client JS if needed
  })

  return json({ success: true, locale })
}
```

---

## Rules & Guidelines

1. **At Least Dual-Locale**: Every project adopting localization must define at least `en` and the primary locale (e.g. `id`).
2. **English is the Fallback**: If an entry in `id.ts` is temporarily missing, runtime translation must gracefully fall back to `en.ts`, never throw or return an empty string.
3. **No Non-English Identifiers**: Variable names, database column names, and API route paths are always English (`userName`, not `namaPengguna`).
4. **Compile-Time Validation**: Non-English dictionaries must use `satisfies Dictionary` to ensure complete coverage.
5. **No Magic Strings in UI**: User-facing labels must be referenced via the dictionary (`t.auth.loginTitle`), never hardcoded strings inside markup.

---

## Incorrect / Correct

**Incorrect — Hardcoded mixed language in components and service:**

```ts
// BAD: Business service returning Indonesian message directly
if (!post) throw new NotFoundError('Data artikel tidak ditemukan')
```

```svelte
<!-- BAD: Hardcoded mixed language in UI markup -->
<button>Simpan Data / Save</button>
```

**Correct — English domain error with client-side localization:**

```ts
// GOOD: English domain error
if (!post) throw new NotFoundError('Post not found') // API code: 'NOT_FOUND'
```

```svelte
<!-- GOOD: Localized via type-safe dictionary -->
<script lang="ts">
  let t = $derived(getDictionary(locale))
</script>

<button>{t.common.save}</button>
{#if apiError}
  <p>{translateErrorCode(apiError.code, locale)}</p>
{/if}
```
