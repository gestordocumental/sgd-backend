# Build context must be the monorepo root:
#   docker build -f services/metadata-extractor-service/Dockerfile .

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY packages/common/package.json ./packages/common/
COPY services/metadata-extractor-service/package*.json ./services/metadata-extractor-service/

RUN npm ci

COPY packages/common/tsconfig.json ./packages/common/
COPY packages/common/src ./packages/common/src
RUN cd packages/common && npx tsc

COPY services/metadata-extractor-service/nest-cli.json ./services/metadata-extractor-service/
COPY services/metadata-extractor-service/tsconfig*.json ./services/metadata-extractor-service/
COPY services/metadata-extractor-service/src ./services/metadata-extractor-service/src

WORKDIR /app/services/metadata-extractor-service

RUN npm run build

# ── Stage 2: production ───────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY packages/common/package.json ./packages/common/
COPY services/metadata-extractor-service/package*.json ./services/metadata-extractor-service/

RUN npm ci --omit=dev

COPY --from=builder /app/packages/common/dist ./packages/common/dist
COPY --from=builder /app/services/metadata-extractor-service/dist ./services/metadata-extractor-service/dist
COPY services/metadata-extractor-service/start.sh ./services/metadata-extractor-service/start.sh
RUN sed -i 's/\r//' services/metadata-extractor-service/start.sh && chmod +x services/metadata-extractor-service/start.sh

WORKDIR /app/services/metadata-extractor-service

EXPOSE 3004

USER node

CMD ["sh", "start.sh"]
