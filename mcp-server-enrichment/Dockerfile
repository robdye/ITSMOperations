FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc --noEmit

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/src ./src
RUN rm -rf /app/src/__tests__
COPY --from=builder /app/tsconfig.json ./
RUN npm install -g tsx@4
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O- http://localhost:3010/health | grep -q '"status":"ok"' || exit 1
CMD ["tsx", "src/index.ts"]
