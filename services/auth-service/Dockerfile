# Build context must be the monorepo root:
#   docker build -f services/auth-service/Dockerfile .

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace manifests for dependency installation
COPY package*.json ./
COPY packages/common/package.json ./packages/common/
COPY services/auth-service/package*.json ./services/auth-service/

# Install all workspace dependencies
RUN npm ci

# Copy and build the shared common package first
COPY packages/common/tsconfig.json ./packages/common/
COPY packages/common/src ./packages/common/src
RUN cd packages/common && npx tsc

# Copy and build the auth-service
COPY services/auth-service/nest-cli.json ./services/auth-service/
COPY services/auth-service/tsconfig*.json ./services/auth-service/
COPY services/auth-service/src ./services/auth-service/src
COPY services/auth-service/start.sh ./services/auth-service/start.sh
RUN sed -i 's/\r//' services/auth-service/start.sh && chmod +x services/auth-service/start.sh

WORKDIR /app/services/auth-service

RUN npm run build

# Compila data-source y migraciones (no forman parte del árbol de módulos de NestJS)
RUN npx tsc -p tsconfig.migrations.json

# ── Stage 2: production ───────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Copy workspace manifests for production install
COPY package*.json ./
COPY packages/common/package.json ./packages/common/
COPY services/auth-service/package*.json ./services/auth-service/

# Only production dependencies
RUN npm ci --omit=dev

# Copy compiled common package (runtime resolution via workspace symlink)
COPY --from=builder /app/packages/common/dist ./packages/common/dist

# Copy compiled auth-service
COPY --from=builder /app/services/auth-service/dist ./services/auth-service/dist
COPY --from=builder /app/services/auth-service/start.sh ./services/auth-service/start.sh

WORKDIR /app/services/auth-service

EXPOSE 3000

USER node

CMD ["sh", "start.sh"]
