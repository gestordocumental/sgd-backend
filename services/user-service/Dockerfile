# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY nest-cli.json tsconfig.json tsconfig.migrations.json ./
COPY src ./src

RUN npm run build

# Compila data-source y migraciones (no forman parte del árbol de módulos de NestJS)
RUN npx tsc -p tsconfig.migrations.json

# ── Stage 2: production ───────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production

# Solo las dependencias de producción
COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY start.sh ./start.sh

EXPOSE 3001

USER node

CMD ["sh", "start.sh"]
