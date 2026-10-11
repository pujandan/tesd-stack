#!/usr/bin/env node

/**
 * scaffold-project.js — Automated Scaffolder for the TESD Stack.
 * 
 * Generates a complete, production-ready, clean architecture codebase:
 * TypeScript + SvelteKit 3 (Svelte 5 runes) + ElysiaJS + Drizzle ORM + PostgreSQL + i18n (en/id).
 * 
 * Usage:
 *   node scripts/scaffold-project.js <target-dir> [--name <app-name>]
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
Usage:
  node scaffold-project.js <target-directory> [--name <project-name>]

Examples:
  node scaffold-project.js ./my-app
  node scaffold-project.js ../e-commerce --name "store-api"
`);
  process.exit(0);
}

const targetDirArg = args[0];
let appName = path.basename(path.resolve(targetDirArg));

for (let i = 1; i < args.length; i++) {
  if (args[i] === '--name' && args[i + 1]) {
    appName = args[i + 1];
    i++;
  }
}

const targetDir = path.resolve(targetDirArg);

console.log(`🚀 Scaffolding TESD Stack project: "${appName}" in ${targetDir}`);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeFile(relPath, content) {
  const fullPath = path.join(targetDir, relPath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content.trimStart(), 'utf-8');
}

// 1. package.json
writeFile('package.json', JSON.stringify({
  name: appName,
  version: '0.1.0',
  private: true,
  type: 'module',
  scripts: {
    dev: 'vite dev',
    build: 'vite build',
    preview: 'vite preview',
    check: 'svelte-check --tsconfig ./tsconfig.json && tsc --noEmit',
    lint: 'eslint .',
    'deps:cycles': 'madge --circular src/lib/server',
    'db:generate': 'drizzle-kit generate',
    'db:migrate': 'tsx scripts/migrate.ts',
    'db:check': 'drizzle-kit check',
    test: 'vitest run',
    'test:unit': 'vitest run --project unit',
    'test:integration': 'vitest run --project integration',
    'test:coverage': 'vitest run --coverage'
  },
  dependencies: {
    '@elysiajs/eden': '^1.2.0',
    '@node-rs/argon2': '^2.0.2',
    '@sinclair/typebox': '^0.34.14',
    '@sveltejs/adapter-node': '^6.0.0',
    'drizzle-orm': '^0.39.0',
    elysia: '^1.2.10',
    pg: '^8.13.1',
    pino: '^9.6.0'
  },
  devDependencies: {
    '@sveltejs/kit': '^3.0.1',
    '@sveltejs/vite-plugin-svelte': '^7.3.1',
    '@types/node': '^22.10.10',
    '@types/pg': '^8.11.10',
    dotenv: '^16.4.7',
    'drizzle-kit': '^0.30.2',
    eslint: '^9.18.0',
    madge: '^8.0.0',
    'pino-pretty': '^13.0.0',
    svelte: '^5.57.2',
    'svelte-check': '^4.1.4',
    tsx: '^4.19.2',
    typescript: '^5.7.3',
    vite: '^8.3.4',
    vitest: '^3.0.0'
  }
}, null, 2) + '\n');

// 2. tsconfig.json
writeFile('tsconfig.json', JSON.stringify({
  extends: './.svelte-kit/tsconfig.json',
  compilerOptions: {
    strict: true,
    noUncheckedIndexedAccess: true,
    noImplicitOverride: true,
    noFallthroughCasesInSwitch: true,
    verbatimModuleSyntax: true,
    forceConsistentCasingInFileNames: true,
    skipLibCheck: true,
    moduleResolution: 'bundler'
  }
}, null, 2) + '\n');

// 3. svelte.config.js
writeFile('svelte.config.js', `import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    csp: {
      mode: 'auto',
      directives: {
        'default-src': ["'self'"],
        'img-src': ["'self'", 'data:', 'https:'],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'frame-ancestors': ["'none'"]
      }
    }
  }
};

export default config;
`);

// 4. vite.config.ts
writeFile('vite.config.ts', `import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 3000
  }
});
`);

// 5. vitest.config.ts
writeFile('vitest.config.ts', `import { sveltekit } from '@sveltejs/kit/vite';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit()],
  resolve: {
    alias: { $tests: fileURLToPath(new URL('./tests', import.meta.url)) }
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.integration.test.ts'],
          environment: 'node'
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
          fileParallelism: false
        }
      }
    ]
  }
});
`);

// 6. drizzle.config.ts
writeFile('drizzle.config.ts', `import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/lib/server/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? ''
  },
  strict: true,
  verbose: true
});
`);

// 7. .env.example, .env, and .env.test
const envExample = `# ==============================================================================
# Application & Container Configuration
# ==============================================================================
COMPOSE_PROJECT_NAME=${appName}
NODE_ENV=development

# Server & Origin
APP_PORT=3000
APP_ORIGIN="http://localhost:3000"
ORIGIN="http://localhost:3000"
LOG_LEVEL="debug"
PORT=3000
HOST="0.0.0.0"

# PostgreSQL Database
DB_PORT=5432
DB_DATABASE=${appName}
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_SSL_MODE=disable
DATABASE_URL="postgres://postgres:postgres@localhost:5432/${appName}?sslmode=disable"

# Redis (Cache, Distributed Rate Limiter, Queues)
REDIS_PORT=6379
REDIS_PASSWORD=""
REDIS_URL="redis://localhost:6379"

# Object Storage (MinIO / S3)
S3_ENDPOINT="http://localhost:9000"
S3_ACCESS_KEY="minioadmin"
S3_SECRET_KEY="minioadmin"
S3_BUCKET="${appName}-uploads"
S3_REGION="us-east-1"
MINIO_PORT_API=9000
MINIO_PORT_CONSOLE=9001

# Database Web UI (pgweb)
DB_PORT_WEB=8081
`;

writeFile('.env.example', envExample);
writeFile('.env', envExample);
writeFile('.env.test', `# Dedicated test database ending in _test (prevents destructive TRUNCATE on prod)
DATABASE_URL="postgres://postgres:postgres@localhost:5432/${appName}_test?sslmode=disable"
ORIGIN="http://localhost:3000"
LOG_LEVEL="error"
`);

// 8. Container Configuration: Dockerfile, .dockerignore, compose.yaml (Docker & Podman)
writeFile('Dockerfile', `# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "build"]
`);

writeFile('.dockerignore', `node_modules
.svelte-kit
build
dist
.env
.env.*
!.env.example
.git
.github
.gitignore
*.log
npm-debug.log*
.DS_Store
`);

writeFile('compose.yaml', `# ==============================================================================
# TESD Stack — Container Compose Template (Docker & Podman Compatible)
# ==============================================================================
# ZERO hardcoded configuration: All values read from .env with fallback defaults.
# Compatible with both \`docker compose\` and \`podman compose\`.
#
# Commands:
#   docker compose up -d    OR    podman compose up -d
#   docker compose down     OR    podman compose down
#   docker compose ps       OR    podman compose ps
#   docker compose logs -f  OR    podman compose logs -f
# ==============================================================================

services:
  # 1. Main Application (SvelteKit 3 + Embedded ElysiaJS)
  app:
    build:
      context: .
      dockerfile: \${APP_DOCKERFILE:-Dockerfile}
    container_name: \${COMPOSE_PROJECT_NAME:-${appName}}_app
    restart: unless-stopped
    environment:
      NODE_ENV: \${NODE_ENV:-production}
      PORT: \${APP_PORT:-3000}
      HOST: 0.0.0.0
      ORIGIN: \${APP_ORIGIN:-http://localhost:3000}
      DATABASE_URL: postgres://\${DB_USERNAME:-postgres}:\${DB_PASSWORD:-postgres}@postgres:5432/\${DB_DATABASE:-${appName}}?sslmode=\${DB_SSL_MODE:-disable}
      REDIS_URL: redis://redis:6379
      LOG_LEVEL: \${LOG_LEVEL:-info}
      S3_ENDPOINT: \${S3_ENDPOINT:-http://minio:9000}
      S3_ACCESS_KEY: \${S3_ACCESS_KEY:-minioadmin}
      S3_SECRET_KEY: \${S3_SECRET_KEY:-minioadmin}
      S3_BUCKET: \${S3_BUCKET:-${appName}-uploads}
      S3_REGION: \${S3_REGION:-us-east-1}
    ports:
      - "\${APP_PORT:-3000}:\${APP_PORT:-3000}"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:\${APP_PORT:-3000}/healthz || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
    networks:
      - app-network
    deploy:
      resources:
        limits:
          cpus: '\${APP_CPU_LIMIT:-2}'
          memory: \${APP_MEM_LIMIT:-1G}
        reservations:
          cpus: '\${APP_CPU_RES:-0.5}'
          memory: \${APP_MEM_RES:-256M}
    security_opt:
      - no-new-privileges:true

  # 2. PostgreSQL Database
  postgres:
    image: postgres:\${POSTGRES_VERSION:-17-alpine}
    container_name: \${COMPOSE_PROJECT_NAME:-${appName}}_postgres
    restart: unless-stopped
    command: >
      postgres
      -c max_connections=\${DB_MAX_CONNECTIONS:-100}
      -c shared_buffers=\${DB_SHARED_BUFFERS:-256MB}
      -c effective_cache_size=\${DB_EFFECTIVE_CACHE:-768MB}
      -c maintenance_work_mem=\${DB_MAINT_WORK_MEM:-64MB}
      -c checkpoint_completion_target=0.9
      -c wal_buffers=16MB
    environment:
      POSTGRES_DB: \${DB_DATABASE:-${appName}}
      POSTGRES_USER: \${DB_USERNAME:-postgres}
      POSTGRES_PASSWORD: \${DB_PASSWORD:-postgres}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "\${DB_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${DB_USERNAME:-postgres} -d \${DB_DATABASE:-${appName}}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
    networks:
      - app-network
    deploy:
      resources:
        limits:
          cpus: '\${DB_CPU_LIMIT:-2}'
          memory: \${DB_MEM_LIMIT:-2G}
        reservations:
          cpus: '\${DB_CPU_RES:-0.5}'
          memory: \${DB_MEM_RES:-512M}
    security_opt:
      - no-new-privileges:true

  # 3. Redis (Cache, Distributed Rate Limiter, and Queues)
  redis:
    image: redis:\${REDIS_VERSION:-7-alpine}
    container_name: \${COMPOSE_PROJECT_NAME:-${appName}}_redis
    restart: unless-stopped
    command: redis-server --appendonly yes
    environment:
      REDIS_REPLICATION_MODE: master
    volumes:
      - redis_data:/data
    ports:
      - "\${REDIS_PORT:-6379}:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 5s
    networks:
      - app-network
    deploy:
      resources:
        limits:
          cpus: '\${REDIS_CPU_LIMIT:-1}'
          memory: \${REDIS_MEM_LIMIT:-512M}
        reservations:
          cpus: '\${REDIS_CPU_RES:-0.25}'
          memory: \${REDIS_MEM_RES:-128M}
    security_opt:
      - no-new-privileges:true

  # 4. MinIO (S3-Compatible Object Storage for Uploads)
  minio:
    image: quay.io/minio/minio:\${MINIO_VERSION:-RELEASE.2025-09-07T16-13-09Z}
    container_name: \${COMPOSE_PROJECT_NAME:-${appName}}_minio
    restart: unless-stopped
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: \${S3_ACCESS_KEY:-minioadmin}
      MINIO_ROOT_PASSWORD: \${S3_SECRET_KEY:-minioadmin}
      MINIO_REGION: \${S3_REGION:-us-east-1}
      MINIO_BROWSER: \${MINIO_BROWSER:-true}
    volumes:
      - minio_data:/data
    ports:
      - "\${MINIO_PORT_API:-9000}:9000"
      - "\${MINIO_PORT_CONSOLE:-9001}:9001"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:9000/minio/health/live"]
      interval: 20s
      timeout: 10s
      retries: 3
    networks:
      - app-network
    deploy:
      resources:
        limits:
          cpus: '\${MINIO_CPU_LIMIT:-1}'
          memory: \${MINIO_MEM_LIMIT:-1G}
        reservations:
          cpus: '\${MINIO_CPU_RES:-0.25}'
          memory: \${MINIO_MEM_RES:-256M}
    security_opt:
      - no-new-privileges:true

  # 5. MinIO Initialization (Auto-Create Default S3 Bucket)
  minio-init:
    image: docker.io/minio/mc:\${MINIO_MC_VERSION:-RELEASE.2025-08-13T08-35-41Z}
    container_name: \${COMPOSE_PROJECT_NAME:-${appName}}_minio_init
    restart: "no"
    depends_on:
      - minio
    entrypoint: >
      /bin/sh -c "
      /usr/bin/mc alias set local http://minio:9000 \${S3_ACCESS_KEY:-minioadmin} \${S3_SECRET_KEY:-minioadmin};
      /usr/bin/mc mb local/\${S3_BUCKET:-${appName}-uploads} --ignore-existing;
      /usr/bin/mc anonymous set download local/\${S3_BUCKET:-${appName}-uploads};
      exit 0;
      "
    networks:
      - app-network

  # 6. Database Web GUI (pgweb)
  pgweb:
    image: sosedoff/pgweb:\${PGWEB_VERSION:-latest}
    container_name: \${COMPOSE_PROJECT_NAME:-${appName}}_pgweb
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://\${DB_USERNAME:-postgres}:\${DB_PASSWORD:-postgres}@postgres:5432/\${DB_DATABASE:-${appName}}?sslmode=\${DB_SSL_MODE:-disable}
    ports:
      - "\${DB_PORT_WEB:-8081}:8081"
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - app-network
    security_opt:
      - no-new-privileges:true

networks:
  app-network:
    driver: bridge
    name: \${COMPOSE_PROJECT_NAME:-${appName}}_app_network

volumes:
  postgres_data:
    name: \${COMPOSE_PROJECT_NAME:-${appName}}_postgres_data
    driver: local
  redis_data:
    name: \${COMPOSE_PROJECT_NAME:-${appName}}_redis_data
    driver: local
  minio_data:
    name: \${COMPOSE_PROJECT_NAME:-${appName}}_minio_data
    driver: local
`);

// 9. .gitignore
writeFile('.gitignore', `node_modules/
.svelte-kit/
build/
dist/
.env
.env.*
!.env.example
.DS_Store
*.log
`);

// 9. scripts/migrate.ts
writeFile('scripts/migrate.ts', `import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  const pool = new Pool({ connectionString, max: 1 });
  const db = drizzle(pool);

  console.log('⏳ Running PostgreSQL migrations...');
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('✅ Migrations completed successfully.');
  } finally {
    await pool.end();
  }
}

runMigrations().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
`);

// 10. src/app.d.ts
writeFile('src/app.d.ts', `import type { AuthUser } from '$lib/server/modules/session';
import type { Locale } from '$lib/shared/i18n';

declare global {
  namespace App {
    interface Locals {
      user: AuthUser | null;
      locale: Locale;
    }
  }
}

export {};
`);

// 11. src/hooks.server.ts
writeFile('src/hooks.server.ts', `import type { Handle, HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { sessionService, SESSION_COOKIE_NAME } from '$lib/server/modules/session';
import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from '$lib/shared/i18n';
import { logger } from '$lib/server/logger';

export const LOCALE_COOKIE_NAME = 'locale';

function resolveLocale(cookies: { get: (name: string) => string | undefined }, acceptLanguageHeader: string | null): Locale {
  const cookieValue = cookies.get(LOCALE_COOKIE_NAME);
  if (isSupportedLocale(cookieValue)) return cookieValue;

  if (acceptLanguageHeader) {
    const preferred = acceptLanguageHeader.split(',').map((part) => part.split(';')[0]?.trim().toLowerCase());
    for (const lang of preferred) {
      if (!lang) continue;
      const prefix = lang.slice(0, 2);
      if (isSupportedLocale(prefix)) return prefix;
    }
  }

  return DEFAULT_LOCALE;
}

const securityHeaders: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  return response;
};

const localeBridge: Handle = async ({ event, resolve }) => {
  const locale = resolveLocale(event.cookies, event.request.headers.get('accept-language'));
  event.locals.locale = locale;

  return resolve(event, {
    transformPageChunk: ({ html }) => html.replace('%lang%', locale)
  });
};

const sessionBridge: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get(SESSION_COOKIE_NAME);
  event.locals.user = token ? await sessionService.authenticate(token) : null;
  return resolve(event);
};

export const handle = sequence(securityHeaders, localeBridge, sessionBridge);

export const handleError: HandleServerError = ({ error, event, status, message }) => {
  const errorId = crypto.randomUUID();
  logger.error({ err: error, errorId, path: event.url.pathname, status }, 'Unhandled SvelteKit server error');
  return {
    message: status === 404 ? message : 'Internal server error',
    errorId
  };
};
`);

// 12. src/routes/api/[...slugs]/+server.ts (Elysia catch-all mount)
writeFile('src/routes/api/[...slugs]/+server.ts', `import type { RequestHandler } from './$types';
import { api } from '$lib/server/api/app';

const handle: RequestHandler = ({ request, getClientAddress }) => {
  const headers = new Headers(request.headers);
  // Prevent IP spoofing: enforce client address determined by SvelteKit adapter-node
  headers.set('x-client-ip', getClientAddress());
  return api.handle(new Request(request, { headers }));
};

export const fallback = handle;
`);

// 13. Health endpoints: healthz and readyz
writeFile('src/routes/healthz/+server.ts', `import { json, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = () => json({ status: 'ok', timestamp: new Date().toISOString() });
`);

writeFile('src/routes/readyz/+server.ts', `import { json, type RequestHandler } from '@sveltejs/kit';
import { pingDatabase } from '$lib/server/db';
import { logger } from '$lib/server/logger';

export const GET: RequestHandler = async () => {
  try {
    await pingDatabase();
    return json({ status: 'ready', database: 'connected' });
  } catch (err) {
    logger.error({ err }, 'Readiness probe failed');
    return json({ status: 'degraded', database: 'disconnected' }, { status: 503 });
  }
};
`);

// 14. Locale Switcher Endpoint
writeFile('src/routes/api/locale/+server.ts', `import { json, type RequestHandler } from '@sveltejs/kit';
import { isSupportedLocale } from '$lib/shared/i18n';
import { LOCALE_COOKIE_NAME } from '../../../hooks.server';

export const POST: RequestHandler = async ({ request, cookies }) => {
  const body = await request.json().catch(() => ({}));
  const { locale } = body;

  if (!isSupportedLocale(locale)) {
    return json({ error: 'Unsupported locale' }, { status: 400 });
  }

  cookies.set(LOCALE_COOKIE_NAME, locale, {
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
    sameSite: 'lax',
    httpOnly: false
  });

  return json({ success: true, locale });
};
`);

// 15. src/lib/api/client.ts (Eden Treaty)
writeFile('src/lib/api/client.ts', `import { treaty } from '@elysiajs/eden';
import type { Api } from '$lib/server/api/app';

/**
 * Type-safe API client for both SSR and browser.
 * SSR: pass event.fetch and url.origin. Browser: pass nothing.
 */
export function createApiClient(
  fetcher: typeof fetch = fetch,
  origin = typeof location !== 'undefined' ? location.origin : ''
) {
  return treaty<Api>(origin, { fetcher });
}
`);

// 16. Shared constants & i18n
writeFile('src/lib/shared/constants/roles.ts', `export const ROLES = ['user', 'admin'] as const;
export type Role = (typeof ROLES)[number];
`);

writeFile('src/lib/shared/constants/pagination.ts', `export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
`);

writeFile('src/lib/shared/i18n/locales.ts', `export const SUPPORTED_LOCALES = ['en', 'id'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export function isSupportedLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
`);

writeFile('src/lib/shared/i18n/dictionaries/en.ts', `export const en = {
  common: {
    appName: '${appName}',
    welcome: 'Welcome to ${appName}',
    subtitle: 'High performance web application built on the TESD stack',
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
    passwordLabel: 'Password',
    loggedInAs: 'Logged in as'
  },
  errors: {
    BAD_REQUEST: 'The submitted request is invalid.',
    UNAUTHORIZED: 'You must be logged in to perform this action.',
    FORBIDDEN: 'You do not have permission to access this resource.',
    NOT_FOUND: 'The requested resource was not found.',
    CONFLICT: 'This resource already exists.',
    VALIDATION_ERROR: 'Please check your inputs and try again.',
    RATE_LIMITED: 'Too many requests. Please wait a moment.',
    INTERNAL: 'An unexpected server error occurred.'
  }
} as const;

export type Dictionary = typeof en;
`);

writeFile('src/lib/shared/i18n/dictionaries/id.ts', `import type { Dictionary } from './en';

export const id = {
  common: {
    appName: '${appName}',
    welcome: 'Selamat Datang di ${appName}',
    subtitle: 'Aplikasi web berkinerja tinggi berbasis TESD stack',
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
    passwordLabel: 'Kata Sandi',
    loggedInAs: 'Masuk sebagai'
  },
  errors: {
    BAD_REQUEST: 'Permintaan yang dikirimkan tidak valid.',
    UNAUTHORIZED: 'Anda harus masuk terlebih dahulu untuk melakukan aksi ini.',
    FORBIDDEN: 'Anda tidak memiliki izin untuk mengakses sumber daya ini.',
    NOT_FOUND: 'Data yang dicari tidak ditemukan.',
    CONFLICT: 'Data sudah ada sebelumnya.',
    VALIDATION_ERROR: 'Mohon periksa kembali input Anda dan coba lagi.',
    RATE_LIMITED: 'Terlalu banyak permintaan. Silakan tunggu beberapa saat.',
    INTERNAL: 'Terjadi kesalahan pada server.'
  }
} as const satisfies Dictionary;
`);

writeFile('src/lib/shared/i18n/index.ts', `import { en, type Dictionary } from './dictionaries/en';
import { id } from './dictionaries/id';
import { DEFAULT_LOCALE, type Locale } from './locales';

const DICTIONARIES: Record<Locale, Dictionary> = { en, id };

export function getDictionary(locale: Locale = DEFAULT_LOCALE): Dictionary {
  return DICTIONARIES[locale] ?? DICTIONARIES[DEFAULT_LOCALE];
}

export function translateErrorCode(code: string, locale: Locale): string {
  const dict = getDictionary(locale);
  return (dict.errors as Record<string, string>)[code] ?? dict.errors.INTERNAL;
}

export * from './locales';
export type { Dictionary };
`);

// 17. Server Infrastructure (env, logger, errors)
writeFile('src/lib/server/env.ts', `import { env as raw } from '$env/dynamic/private';
import { building, dev } from '$app/environment';

function required(name: string): string {
  const value = raw[name];
  if (!value) throw new Error(\`Missing required environment variable: \${name}\`);
  return value;
}

function loadEnv() {
  return {
    DATABASE_URL: required('DATABASE_URL'),
    ORIGIN: required('ORIGIN'),
    LOG_LEVEL: raw.LOG_LEVEL ?? (dev ? 'debug' : 'info'),
    IS_PROD: !dev
  } as const;
}

export type Env = ReturnType<typeof loadEnv>;

export const env: Env = building
  ? { DATABASE_URL: '', ORIGIN: '', LOG_LEVEL: 'info', IS_PROD: true }
  : loadEnv();
`);

writeFile('src/lib/server/logger.ts', `import pino from 'pino';
import { env } from '$lib/server/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'password',
      'passwordHash',
      'token',
      '*.password',
      '*.passwordHash',
      '*.token',
      'headers.authorization',
      'headers.cookie',
      'req.headers.authorization',
      'req.headers.cookie'
    ],
    censor: '[REDACTED]'
  }
});
`);

writeFile('src/lib/server/errors/domain-error.ts', `export type DomainErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED';

export class DomainError extends Error {
  constructor(public readonly code: DomainErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends DomainError {
  constructor(message = 'Invalid request') { super('BAD_REQUEST', message); }
}

export class UnauthorizedError extends DomainError {
  constructor(message = 'Authentication required') { super('UNAUTHORIZED', message); }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Insufficient permissions') { super('FORBIDDEN', message); }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Resource not found') { super('NOT_FOUND', message); }
}

export class ConflictError extends DomainError {
  constructor(message = 'Resource already exists') { super('CONFLICT', message); }
}

export class TooManyRequestsError extends DomainError {
  constructor(public readonly retryAfterSeconds?: number, message = 'Too many requests') {
    super('RATE_LIMITED', message);
  }
}
`);

// 18. Server DB & Transaction
writeFile('src/lib/server/db/schema/_columns.ts', `import { timestamp } from 'drizzle-orm/pg-core';

export const timestampColumn = (name: string) =>
  timestamp(name, { withTimezone: true, precision: 3 });

export const timestamps = {
  createdAt: timestampColumn('created_at').notNull().defaultNow(),
  updatedAt: timestampColumn('updated_at').notNull().defaultNow().$onUpdate(() => new Date())
};
`);

writeFile('src/lib/server/db/schema/user.ts', `import { check, pgEnum, pgTable, text, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { ROLES } from '$lib/shared/constants/roles';
import { timestamps } from './_columns';

export const userRoleEnum = pgEnum('user_role', ROLES);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  role: userRoleEnum('role').notNull().default('user'),
  ...timestamps
}, (table) => [
  check('users_email_lowercase_chk', sql\`\${table.email} = lower(\${table.email})\`)
]);
`);

writeFile('src/lib/server/db/schema/session.ts', `import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestampColumn } from './_columns';
import { users } from './user';

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestampColumn('expires_at').notNull(),
  createdAt: timestampColumn('created_at').notNull().defaultNow()
}, (table) => [
  index('sessions_user_id_idx').on(table.userId),
  index('sessions_expires_at_idx').on(table.expiresAt)
]);
`);

writeFile('src/lib/server/db/schema/index.ts', `export * from './_columns';
export * from './user';
export * from './session';
`);

writeFile('src/lib/server/db/index.ts', `import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '$lib/server/env';
import { logger } from '$lib/server/logger';
import * as schema from './schema';

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

function createPool(): Pool {
  const created = new Pool({
    connectionString: env.DATABASE_URL,
    max: env.IS_PROD ? 20 : 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000
  });

  created.on('error', (err) => logger.error({ err }, 'Unexpected PostgreSQL pool error'));
  return created;
}

const pool = globalThis.__pgPool ?? createPool();
if (!env.IS_PROD) globalThis.__pgPool = pool;

export const db = drizzle(pool, { schema });

export type Database = typeof db;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Database | Transaction;

export const closeDatabase = () => pool.end();
export const pingDatabase = async () => {
  await pool.query('select 1');
};
`);

writeFile('src/lib/server/db/transaction.ts', `import { db, type Transaction } from './index';

export type { Transaction };

export function withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(work);
}
`);

// 19. Shared server helpers (cursor, pagination, rate-limiter)
writeFile('src/lib/server/shared/cursor.ts', `import { BadRequestError } from '$lib/server/errors/domain-error';

export interface Cursor {
  createdAt: Date;
  id: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeCursor(row: Cursor): string {
  return Buffer.from(\`\${row.createdAt.toISOString()}|\${row.id}\`).toString('base64url');
}

export function parseCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  const [iso, id, ...rest] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso ?? '');
  if (rest.length > 0 || Number.isNaN(createdAt.getTime()) || !id || !UUID_PATTERN.test(id)) {
    throw new BadRequestError('Invalid cursor format');
  }
  return { createdAt, id };
}
`);

writeFile('src/lib/server/shared/pagination.ts', `import { t } from 'elysia';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '$lib/shared/constants/pagination';
import { encodeCursor, type Cursor } from './cursor';

export const paginationQuerySchema = t.Object({
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE })),
  cursor: t.Optional(t.String({ maxLength: 200 }))
}, { additionalProperties: false });

export function toPage<T extends Cursor>(rows: T[], limit: number): { items: T[]; nextCursor: string | null } {
  const hasNext = rows.length > limit;
  const items = hasNext ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    nextCursor: hasNext && last ? encodeCursor(last) : null
  };
}
`);

writeFile('src/lib/server/shared/rate-limiter.ts', `export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(key: string): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

export function createRateLimiter(options: { windowMs: number; max: number }): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, options.windowMs).unref();

  return {
    async consume(key) {
      const now = Date.now();
      const existing = buckets.get(key);
      const bucket = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + options.windowMs };
      bucket.count += 1;
      buckets.set(key, bucket);
      return {
        allowed: bucket.count <= options.max,
        retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000)
      };
    },
    async reset(key) {
      buckets.delete(key);
    }
  };
}
`);

// 20. Elysia Root App & Plugins
writeFile('src/lib/server/api/plugins/request-context.plugin.ts', `import { Elysia } from 'elysia';
import { logger } from '$lib/server/logger';

export const requestContextPlugin = new Elysia({ name: 'request-context' })
  .derive({ as: 'global' }, ({ request, set }) => {
    const requestId = crypto.randomUUID();
    set.headers['x-request-id'] = requestId;
    return {
      requestId,
      startedAt: performance.now(),
      clientIp: request.headers.get('x-client-ip') ?? 'unknown'
    };
  })
  .onAfterResponse({ as: 'global' }, ({ request, set, requestId, startedAt }) => {
    logger.info({
      requestId,
      method: request.method,
      path: new URL(request.url).pathname,
      status: Number(set.status ?? 200),
      durationMs: Math.round(performance.now() - startedAt)
    }, 'HTTP request completed');
  });
`);

writeFile('src/lib/server/api/plugins/error.plugin.ts', `import { Elysia } from 'elysia';
import { DomainError, TooManyRequestsError, type DomainErrorCode } from '$lib/server/errors/domain-error';
import { logger } from '$lib/server/logger';
import { requestContextPlugin } from './request-context.plugin';

const STATUS_BY_CODE = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION_ERROR: 422,
  RATE_LIMITED: 429
} as const satisfies Record<DomainErrorCode, number>;

function envelope(code: string, message: string, requestId: string, fields?: string[]) {
  return { error: { code, message, requestId, ...(fields ? { fields } : {}) } };
}

export const errorPlugin = new Elysia({ name: 'error' })
  .use(requestContextPlugin)
  .onError({ as: 'global' }, ({ code, error: err, set, requestId }) => {
    if (err instanceof DomainError) {
      set.status = STATUS_BY_CODE[err.code];
      if (err instanceof TooManyRequestsError && err.retryAfterSeconds) {
        set.headers['retry-after'] = String(err.retryAfterSeconds);
      }
      return envelope(err.code, err.message, requestId);
    }

    switch (code) {
      case 'VALIDATION':
        set.status = 422;
        return envelope('VALIDATION_ERROR', 'Validation failed', requestId, err.all.map((i) => i.path));
      case 'PARSE':
        set.status = 400;
        return envelope('BAD_REQUEST', 'Malformed request payload', requestId);
      case 'NOT_FOUND':
        set.status = 404;
        return envelope('NOT_FOUND', 'Route endpoint not found', requestId);
    }

    logger.error({ err, requestId }, 'Unhandled exception in API');
    set.status = 500;
    return envelope('INTERNAL', 'Internal server error', requestId);
  });
`);

writeFile('src/lib/server/api/plugins/csrf.plugin.ts', `import { Elysia } from 'elysia';
import { env } from '$lib/server/env';
import { ForbiddenError } from '$lib/server/errors/domain-error';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const csrfPlugin = new Elysia({ name: 'csrf' })
  .onBeforeHandle({ as: 'global' }, ({ request }) => {
    if (SAFE_METHODS.has(request.method)) return;
    if (request.headers.has('authorization')) return;

    const origin = request.headers.get('origin');
    if (origin !== null) {
      if (origin !== env.ORIGIN) throw new ForbiddenError('Cross-origin request rejected');
      return;
    }

    if (request.headers.has('cookie')) {
      throw new ForbiddenError('Missing Origin header for cookie authentication');
    }
  });
`);

writeFile('src/lib/server/api/plugins/rate-limit.plugin.ts', `import { Elysia } from 'elysia';
import { TooManyRequestsError } from '$lib/server/errors/domain-error';
import { createRateLimiter } from '$lib/server/shared/rate-limiter';
import { requestContextPlugin } from './request-context.plugin';

export function rateLimitPlugin(options: { name: string; windowMs: number; max: number }) {
  const limiter = createRateLimiter(options);
  return new Elysia({ name: \`rate-limit:\${options.name}\` })
    .use(requestContextPlugin)
    .onBeforeHandle({ as: 'scoped' }, async ({ clientIp }) => {
      const result = await limiter.consume(clientIp);
      if (!result.allowed) throw new TooManyRequestsError(result.retryAfterSeconds);
    });
}
`);

// 21. Modules: Session, Auth, User
writeFile('src/lib/server/modules/session/session.types.ts', `import type { Role } from '$lib/shared/constants/roles';

export interface AuthUser {
  id: string;
  role: Role;
}
`);

writeFile('src/lib/server/modules/session/session.cookie.ts', `import { env } from '$lib/server/env';

export const SESSION_COOKIE_NAME = 'session';
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: env.IS_PROD,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt
  } as const;
}
`);

writeFile('src/lib/server/modules/session/session.repository.ts', `import { and, eq, gt } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { sessions, users } from '$lib/server/db/schema';

export const sessionRepository = {
  async insert(values: { userId: string; tokenHash: string; expiresAt: Date }, executor: DbExecutor = db) {
    await executor.insert(sessions).values(values);
  },

  async findActiveUserByTokenHash(tokenHash: string, executor: DbExecutor = db) {
    const [row] = await executor
      .select({ userId: users.id, role: users.role })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
      .limit(1);

    return row;
  },

  async deleteByTokenHash(tokenHash: string, executor: DbExecutor = db) {
    await executor.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  },

  async deleteAllForUser(userId: string, executor: DbExecutor = db) {
    await executor.delete(sessions).where(eq(sessions.userId, userId));
  }
};
`);

writeFile('src/lib/server/modules/session/session.service.ts', `import { createHash, randomBytes } from 'node:crypto';
import { sessionRepository } from './session.repository';
import { SESSION_TTL_MS } from './session.cookie';
import type { AuthUser } from './session.types';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const sessionService = {
  async create(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await sessionRepository.insert({ userId, tokenHash, expiresAt });
    return { token, expiresAt };
  },

  async authenticate(token: string): Promise<AuthUser | null> {
    const tokenHash = hashToken(token);
    const row = await sessionRepository.findActiveUserByTokenHash(tokenHash);
    return row ? { id: row.userId, role: row.role } : null;
  },

  async revoke(token: string): Promise<void> {
    await sessionRepository.deleteByTokenHash(hashToken(token));
  },

  async revokeAll(userId: string): Promise<void> {
    await sessionRepository.deleteAllForUser(userId);
  }
};
`);

writeFile('src/lib/server/modules/session/session.plugin.ts', `import { Elysia } from 'elysia';
import { ForbiddenError, UnauthorizedError } from '$lib/server/errors/domain-error';
import { sessionService } from './session.service';
import { SESSION_COOKIE_NAME } from './session.cookie';
import type { AuthUser } from './session.types';

function readBearerToken(authorization: string | undefined): string | undefined {
  return authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined;
}

async function authenticateRequest(cookieValue: unknown, authorization: string | undefined): Promise<AuthUser> {
  const token = typeof cookieValue === 'string' ? cookieValue : readBearerToken(authorization);
  const user = token ? await sessionService.authenticate(token) : null;
  if (!user) throw new UnauthorizedError();
  return user;
}

export const authPlugin = new Elysia({ name: 'auth' }).macro({
  requireAuth: {
    async resolve({ cookie, headers }) {
      return { user: await authenticateRequest(cookie[SESSION_COOKIE_NAME]?.value, headers.authorization) };
    }
  },
  requireAdmin: {
    async resolve({ cookie, headers }) {
      const user = await authenticateRequest(cookie[SESSION_COOKIE_NAME]?.value, headers.authorization);
      if (user.role !== 'admin') throw new ForbiddenError('Admin privileges required');
      return { user };
    }
  }
});
`);

writeFile('src/lib/server/modules/session/index.ts', `export * from './session.types';
export * from './session.cookie';
export * from './session.service';
export * from './session.plugin';
`);

// User Module
writeFile('src/lib/server/modules/user/user.schema.ts', `import { t } from 'elysia';
import { ROLES } from '$lib/shared/constants/roles';

export const userRoleSchema = t.Union(ROLES.map((r) => t.Literal(r)));

export const userDtoSchema = t.Object({
  id: t.String({ format: 'uuid' }),
  email: t.String({ format: 'email' }),
  name: t.String(),
  role: userRoleSchema,
  createdAt: t.String()
}, { additionalProperties: false });

export type UserDto = typeof userDtoSchema.static;
`);

writeFile('src/lib/server/modules/user/user.repository.ts', `import { eq } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/server/db';
import { users } from '$lib/server/db/schema';

export type UserRow = typeof users.$inferSelect;

export const userRepository = {
  async findById(id: string, executor: DbExecutor = db) {
    const [row] = await executor.select().from(users).where(eq(users.id, id)).limit(1);
    return row;
  },

  async findCredentialsByEmail(email: string, executor: DbExecutor = db) {
    const [row] = await executor.select().from(users).where(eq(users.email, email)).limit(1);
    return row;
  },

  async insert(data: { email: string; name: string; passwordHash: string }, executor: DbExecutor = db) {
    const [row] = await executor.insert(users).values(data).returning();
    return row!;
  }
};
`);

writeFile('src/lib/server/modules/user/user.service.ts', `import { NotFoundError } from '$lib/server/errors/domain-error';
import { userRepository, type UserRow } from './user.repository';
import type { UserDto } from './user.schema';

function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    createdAt: row.createdAt.toISOString()
  };
}

export const userService = {
  async getById(id: string): Promise<UserDto> {
    const row = await userRepository.findById(id);
    if (!row) throw new NotFoundError('User not found');
    return toUserDto(row);
  }
};
`);

writeFile('src/lib/server/modules/user/index.ts', `export * from './user.schema';
export * from './user.service';
`);

// Auth Module
writeFile('src/lib/server/modules/auth/auth.schema.ts', `import { t } from 'elysia';

export const registerBodySchema = t.Object({
  email: t.String({ format: 'email', maxLength: 255 }),
  name: t.String({ minLength: 1, maxLength: 100 }),
  password: t.String({ minLength: 12, maxLength: 128 })
}, { additionalProperties: false });

export const loginBodySchema = t.Object({
  email: t.String({ format: 'email', maxLength: 255 }),
  password: t.String({ maxLength: 128 })
}, { additionalProperties: false });

export type RegisterBody = typeof registerBodySchema.static;
export type LoginBody = typeof loginBodySchema.static;
`);

writeFile('src/lib/server/modules/auth/auth.service.ts', `import { hash, verify } from '@node-rs/argon2';
import { ConflictError, UnauthorizedError } from '$lib/server/errors/domain-error';
import { userRepository } from '$lib/server/modules/user/user.repository';
import { userService } from '$lib/server/modules/user';
import { sessionService } from '$lib/server/modules/session';
import type { LoginBody, RegisterBody } from './auth.schema';
import type { UserDto } from '$lib/server/modules/user';

const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const authService = {
  async register(input: RegisterBody): Promise<{ user: UserDto; token: string; expiresAt: Date }> {
    const email = normalizeEmail(input.email);
    const existing = await userRepository.findCredentialsByEmail(email);
    if (existing) throw new ConflictError('Email is already registered');

    const passwordHash = await hash(input.password, ARGON2_OPTIONS);
    const row = await userRepository.insert({ email, name: input.name, passwordHash });
    const { token, expiresAt } = await sessionService.create(row.id);
    const user = await userService.getById(row.id);

    return { user, token, expiresAt };
  },

  async login(input: LoginBody): Promise<{ user: UserDto; token: string; expiresAt: Date }> {
    const email = normalizeEmail(input.email);
    const credentials = await userRepository.findCredentialsByEmail(email);

    if (!credentials) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const isValid = await verify(credentials.passwordHash, input.password, ARGON2_OPTIONS);
    if (!isValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    const { token, expiresAt } = await sessionService.create(credentials.id);
    const user = await userService.getById(credentials.id);

    return { user, token, expiresAt };
  },

  async logout(token: string): Promise<void> {
    await sessionService.revoke(token);
  }
};
`);

writeFile('src/lib/server/modules/auth/auth.routes.ts', `import { Elysia, t } from 'elysia';
import { authPlugin, SESSION_COOKIE_NAME, sessionCookieOptions } from '$lib/server/modules/session';
import { userDtoSchema, userService } from '$lib/server/modules/user';
import { rateLimitPlugin } from '$lib/server/api/plugins/rate-limit.plugin';
import { authService } from './auth.service';
import { loginBodySchema, registerBodySchema } from './auth.schema';

const sessionCookieSchema = t.Cookie({ [SESSION_COOKIE_NAME]: t.Optional(t.String()) });

export const authRoutes = new Elysia({ name: 'auth-routes', prefix: '/auth' })
  .use(rateLimitPlugin({ name: 'auth', windowMs: 15 * 60_000, max: 20 }))
  .use(authPlugin)
  .post('/register', async ({ body, cookie, set }) => {
    const { user, token, expiresAt } = await authService.register(body);
    cookie[SESSION_COOKIE_NAME]?.set({ value: token, ...sessionCookieOptions(expiresAt) });
    set.status = 201;
    return user;
  }, { body: registerBodySchema, cookie: sessionCookieSchema, response: { 201: userDtoSchema } })
  .post('/login', async ({ body, cookie }) => {
    const { user, token, expiresAt } = await authService.login(body);
    cookie[SESSION_COOKIE_NAME]?.set({ value: token, ...sessionCookieOptions(expiresAt) });
    return user;
  }, { body: loginBodySchema, cookie: sessionCookieSchema, response: { 200: userDtoSchema } })
  .post('/logout', async ({ cookie, set }) => {
    const sessionCookie = cookie[SESSION_COOKIE_NAME];
    if (typeof sessionCookie?.value === 'string') {
      await authService.logout(sessionCookie.value);
    }
    sessionCookie?.remove();
    set.status = 204;
  }, { cookie: sessionCookieSchema, response: { 204: t.Void() } })
  .get('/me', ({ user }) => userService.getById(user.id), {
    requireAuth: true,
    response: { 200: userDtoSchema }
  });
`);

writeFile('src/lib/server/modules/auth/index.ts', `export * from './auth.schema';
export * from './auth.service';
export * from './auth.routes';
`);

// 22. Wire up root Elysia api in app.ts
writeFile('src/lib/server/api/app.ts', `import { Elysia } from 'elysia';
import { requestContextPlugin } from './plugins/request-context.plugin';
import { errorPlugin } from './plugins/error.plugin';
import { csrfPlugin } from './plugins/csrf.plugin';
import { rateLimitPlugin } from './plugins/rate-limit.plugin';
import { authRoutes } from '$lib/server/modules/auth';

export const api = new Elysia({ prefix: '/api' })
  .use(requestContextPlugin)
  .use(errorPlugin)
  .use(csrfPlugin)
  .use(rateLimitPlugin({ name: 'global', windowMs: 60_000, max: 300 }))
  .use(authRoutes);

export type Api = typeof api;
`);

// 23. UI Pages: Root layout, layout.server, page.svelte
writeFile('src/routes/+layout.server.ts', `import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
  return {
    user: locals.user,
    locale: locals.locale
  };
};
`);

writeFile('src/routes/+layout.svelte', `<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { LayoutData } from './$types';
  import { getDictionary } from '$lib/shared/i18n';

  let { data, children }: { data: LayoutData; children: Snippet } = $props();
  let dict = $derived(getDictionary(data.locale));

  async function switchLocale(newLocale: string) {
    await fetch('/api/locale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: newLocale })
    });
    window.location.reload();
  }
</script>

<svelte:head>
  <title>{dict.common.appName}</title>
</svelte:head>

<div class="app-shell">
  <header class="header">
    <div class="logo">
      <strong>⚡ {dict.common.appName}</strong>
    </div>
    <div class="controls">
      <div class="locale-switcher">
        <button class:active={data.locale === 'en'} onclick={() => switchLocale('en')}>EN</button>
        <button class:active={data.locale === 'id'} onclick={() => switchLocale('id')}>ID</button>
      </div>
      {#if data.user}
        <span class="user-badge">{dict.auth.loggedInAs}: {data.user.id.slice(0, 8)}... ({data.user.role})</span>
      {/if}
    </div>
  </header>

  <main class="content">
    {@render children()}
  </main>
</div>

<style>
  :global(body) {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    background-color: #0d1117;
    color: #e6edf3;
  }
  .app-shell {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 2rem;
    background: #161b22;
    border-bottom: 1px solid #30363d;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .locale-switcher button {
    background: #21262d;
    color: #8b949e;
    border: 1px solid #30363d;
    padding: 0.3rem 0.6rem;
    border-radius: 4px;
    cursor: pointer;
    font-weight: 600;
  }
  .locale-switcher button.active {
    background: #238636;
    color: #fff;
    border-color: #2ea043;
  }
  .user-badge {
    font-size: 0.85rem;
    color: #8b949e;
  }
  .content {
    flex: 1;
    padding: 2rem;
    max-width: 900px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;
  }
</style>
`);

writeFile('src/routes/+page.svelte', `<script lang="ts">
  import type { PageData } from './$types';
  import { getDictionary } from '$lib/shared/i18n';

  let { data }: { data: PageData } = $props();
  let dict = $derived(getDictionary(data.locale));
</script>

<div class="hero">
  <h1>{dict.common.welcome}</h1>
  <p class="subtitle">{dict.common.subtitle}</p>

  <div class="stack-grid">
    <div class="card">
      <h3>TypeScript</h3>
      <p>Strict types, end-to-end type safety, zero <code>any</code>.</p>
    </div>
    <div class="card">
      <h3>ElysiaJS</h3>
      <p>Embedded catch-all route with TypeBox validation & guard macros.</p>
    </div>
    <div class="card">
      <h3>SvelteKit (Svelte 5)</h3>
      <p>Reactive runes, SSR session bridge, Eden Treaty integration.</p>
    </div>
    <div class="card">
      <h3>Drizzle ORM</h3>
      <p>PostgreSQL with millisecond precision, keyset cursors & transactions.</p>
    </div>
  </div>

  <div class="status-box">
    <h4>✅ System Ready</h4>
    <ul>
      <li>API Gateway mounted at <code>/api</code></li>
      <li>Liveness Probe: <a href="/healthz">/healthz</a></li>
      <li>Readiness Probe: <a href="/readyz">/readyz</a></li>
      <li>Active Locale: <strong>{data.locale.toUpperCase()}</strong></li>
    </ul>
  </div>
</div>

<style>
  .hero {
    text-align: center;
    margin-top: 2rem;
  }
  .subtitle {
    color: #8b949e;
    font-size: 1.15rem;
  }
  .stack-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
    margin: 2.5rem 0;
    text-align: left;
  }
  .card {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 1.2rem;
  }
  .card h3 {
    margin-top: 0;
    color: #58a6ff;
  }
  .card p {
    color: #8b949e;
    font-size: 0.9rem;
    line-height: 1.4;
  }
  .status-box {
    background: #161b22;
    border: 1px solid #238636;
    border-radius: 8px;
    padding: 1.5rem;
    text-align: left;
    display: inline-block;
    min-width: 320px;
  }
  .status-box h4 {
    margin-top: 0;
    color: #3fb950;
  }
  .status-box ul {
    margin: 0;
    padding-left: 1.2rem;
    color: #c9d1d9;
    font-size: 0.9rem;
    line-height: 1.8;
  }
  a {
    color: #58a6ff;
  }
</style>
`);

// 24. Tests: setup, global-setup, guard
writeFile('tests/helpers/guard.ts', `export function assertTestDatabase(url: string | undefined): asserts url is string {
  if (!url || !new URL(url).pathname.endsWith('_test')) {
    throw new Error('Integration tests require DATABASE_URL pointing to a database whose name ends with "_test".');
  }
}
`);

writeFile('tests/global-setup.ts', `import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { assertTestDatabase } from './helpers/guard';

export default async function setup() {
  config({ path: '.env.test' });
  const url = process.env.DATABASE_URL;
  assertTestDatabase(url);
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }
}
`);

writeFile('tests/setup.ts', `import { beforeEach } from 'vitest';
import { db } from '$lib/server/db';
import { env } from '$lib/server/env';
import { assertTestDatabase } from './helpers/guard';

beforeEach(async () => {
  assertTestDatabase(env.DATABASE_URL);
  // Clean test state before each run if needed
});
`);

console.log(`
✨ Successfully scaffolded project "${appName}"!

Next steps to run the application:
  1. cd ${targetDirArg}
  2. npm install
  3. Update .env with your PostgreSQL credentials
  4. npm run db:generate && npm run db:migrate
  5. npm run dev
`);
