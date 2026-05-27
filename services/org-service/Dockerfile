# Build context must be the monorepo root:
#   docker build -f services/org-service/Dockerfile .

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/common/package.json ./packages/common/
COPY services/org-service/package*.json ./services/org-service/

RUN npm ci

COPY packages/common/tsconfig.json ./packages/common/
COPY packages/common/src ./packages/common/src
RUN cd packages/common && npx tsc

COPY services/org-service/nest-cli.json ./services/org-service/
COPY services/org-service/tsconfig*.json ./services/org-service/
COPY services/org-service/src ./services/org-service/src

WORKDIR /app/services/org-service

RUN npm run build

# Compila data-source y migraciones (no forman parte del árbol de módulos de NestJS)
RUN npx tsc -p tsconfig.migrations.json

# ── Stage 2: production ───────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY packages/common/package.json ./packages/common/
COPY services/org-service/package*.json ./services/org-service/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/common/dist ./packages/common/dist
COPY --from=builder /app/services/org-service/dist ./services/org-service/dist
COPY services/org-service/start.sh ./services/org-service/start.sh
RUN sed -i 's/\r//' services/org-service/start.sh && chmod +x services/org-service/start.sh

WORKDIR /app/services/org-service

EXPOSE 3002

USER node

CMD ["sh", "start.sh"]
