# syntax=docker/dockerfile:1
# Multi-stage production build for SvelteKit 3 + ElysiaJS (Node.js runtime)

FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies first for efficient layer caching
COPY package*.json .npmrc* ./
RUN npm ci --legacy-peer-deps

# Copy application source and build
COPY . .
RUN npm run build && npm prune --omit=dev --legacy-peer-deps

# Minimal production runtime stage
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

# Run as non-privileged node user
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "build"]
