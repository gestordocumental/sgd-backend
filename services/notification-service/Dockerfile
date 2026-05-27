# Build context must be the monorepo root:
#   docker build -f services/notification-service/Dockerfile .

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/common/package.json ./packages/common/
COPY services/notification-service/package*.json ./services/notification-service/

RUN npm ci

COPY packages/common/tsconfig.json ./packages/common/
COPY packages/common/src ./packages/common/src
RUN cd packages/common && npx tsc

COPY services/notification-service/nest-cli.json ./services/notification-service/
COPY services/notification-service/tsconfig*.json ./services/notification-service/
COPY services/notification-service/src ./services/notification-service/src

WORKDIR /app/services/notification-service

RUN npm run build

# Compila data-source y migraciones (no forman parte del árbol de módulos de NestJS)
RUN npx tsc -p tsconfig.migrations.json

# ── Stage 2: production ───────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY packages/common/package.json ./packages/common/
COPY services/notification-service/package*.json ./services/notification-service/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/common/dist ./packages/common/dist
COPY --from=builder /app/services/notification-service/dist ./services/notification-service/dist
COPY services/notification-service/start.sh ./services/notification-service/start.sh
RUN sed -i 's/\r//' services/notification-service/start.sh && chmod +x services/notification-service/start.sh

WORKDIR /app/services/notification-service

EXPOSE 3006

USER node

CMD ["sh", "start.sh"]
