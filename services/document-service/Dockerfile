# Build context must be the monorepo root:
#   docker build -f services/document-service/Dockerfile .

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/common/package.json ./packages/common/
COPY services/document-service/package*.json ./services/document-service/

RUN npm ci

COPY packages/common/tsconfig.json ./packages/common/
COPY packages/common/src ./packages/common/src
RUN cd packages/common && npx tsc

COPY services/document-service/nest-cli.json ./services/document-service/
COPY services/document-service/tsconfig*.json ./services/document-service/
COPY services/document-service/src ./services/document-service/src

WORKDIR /app/services/document-service

RUN npm run build

# ── Stage 2: production ───────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY packages/common/package.json ./packages/common/
COPY services/document-service/package*.json ./services/document-service/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/common/dist ./packages/common/dist
COPY --from=builder /app/services/document-service/dist ./services/document-service/dist
COPY services/document-service/start.sh ./services/document-service/start.sh
RUN sed -i 's/\r//' services/document-service/start.sh && chmod +x services/document-service/start.sh

WORKDIR /app/services/document-service

EXPOSE 3003

USER node

CMD ["sh", "start.sh"]
