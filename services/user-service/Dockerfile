# Build context must be the monorepo root:
#   docker build -f services/user-service/Dockerfile .

FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
COPY packages/common/package.json ./packages/common/
COPY services/user-service/package*.json ./services/user-service/
RUN npm ci

COPY packages/common/tsconfig.json ./packages/common/
COPY packages/common/src ./packages/common/src
RUN cd packages/common && npx tsc

COPY services/user-service/nest-cli.json ./services/user-service/
COPY services/user-service/tsconfig*.json ./services/user-service/
COPY services/user-service/src ./services/user-service/src
COPY services/user-service/start.sh ./services/user-service/start.sh
RUN sed -i 's/\r//' services/user-service/start.sh && chmod +x services/user-service/start.sh
WORKDIR /app/services/user-service
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY packages/common/package.json ./packages/common/
COPY services/user-service/package*.json ./services/user-service/
RUN npm ci --omit=dev

COPY --from=builder /app/packages/common/dist ./packages/common/dist
COPY --from=builder /app/services/user-service/dist ./services/user-service/dist
COPY --from=builder /app/services/user-service/start.sh ./services/user-service/start.sh

EXPOSE 3000

USER node

WORKDIR /app/services/user-service
CMD ["sh", "start.sh"]
