# Build context must be the monorepo root:
#   docker build -f services/workflow-service/Dockerfile .

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/common/package.json ./packages/common/
COPY services/workflow-service/package*.json ./services/workflow-service/

RUN npm ci

COPY packages/common/tsconfig.json ./packages/common/
COPY packages/common/src ./packages/common/src
RUN cd packages/common && npx tsc

COPY services/workflow-service/nest-cli.json ./services/workflow-service/
COPY services/workflow-service/tsconfig*.json ./services/workflow-service/
COPY services/workflow-service/src ./services/workflow-service/src

WORKDIR /app/services/workflow-service

RUN npm run build

# Compila data-source y migraciones (no forman parte del árbol de módulos de NestJS)
RUN npx tsc -p tsconfig.migrations.json

# ── Stage 2: production ───────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY packages/common/package.json ./packages/common/
COPY services/workflow-service/package*.json ./services/workflow-service/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/common/dist ./packages/common/dist
COPY --from=builder /app/services/workflow-service/dist ./services/workflow-service/dist
COPY services/workflow-service/start.sh ./services/workflow-service/start.sh
RUN sed -i 's/\r//' services/workflow-service/start.sh && chmod +x services/workflow-service/start.sh

WORKDIR /app/services/workflow-service

EXPOSE 3005

USER node

CMD ["sh", "start.sh"]
