# Build context must be the monorepo root:
#   docker build -f services/audit-service/Dockerfile .

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/common/package.json ./packages/common/
COPY services/audit-service/package*.json ./services/audit-service/

RUN npm ci

COPY packages/common/tsconfig.json ./packages/common/
COPY packages/common/src ./packages/common/src
RUN cd packages/common && npx tsc

COPY services/audit-service/nest-cli.json ./services/audit-service/
COPY services/audit-service/tsconfig*.json ./services/audit-service/
COPY services/audit-service/src ./services/audit-service/src

WORKDIR /app/services/audit-service

RUN npm run build

# ── Stage 2: production ───────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY packages/common/package.json ./packages/common/
COPY services/audit-service/package*.json ./services/audit-service/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/common/dist ./packages/common/dist
COPY --from=builder /app/services/audit-service/dist ./services/audit-service/dist

WORKDIR /app/services/audit-service

EXPOSE 3007

USER node

CMD ["node", "dist/main"]
