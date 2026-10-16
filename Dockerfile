# syntax=docker/dockerfile:1
# Multi-stage build. Debian (glibc) base so the prebuilt sharp and @node-rs/argon2 binaries match.
ARG NODE_VERSION=24

# --- build: full install, SvelteKit build, bundled ops scripts ------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npx vite build -c vite.scripts.config.ts

# --- prod-deps: production node_modules only (no drizzle-kit, vite, ...) --------------------
FROM node:${NODE_VERSION}-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- runtime ---------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
LABEL com.kitchen-care.project="kitchen-care"
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    UPLOAD_DIR=/data/uploads \
    BODY_SIZE_LIMIT=6M
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/build-scripts ./scripts
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node package.json ./
# The directory exists with the right owner so a fresh named volume inherits it.
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "build"]
