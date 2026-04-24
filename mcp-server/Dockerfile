FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build:widgets

FROM node:22-slim AS runtime
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY --from=builder /app/src ./src
COPY --from=builder /app/assets ./assets
COPY --from=builder /app/tsconfig.json ./
EXPOSE 3002
CMD ["node", "--import", "tsx", "src/index.ts"]
