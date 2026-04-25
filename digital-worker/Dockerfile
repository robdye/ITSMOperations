FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/mission-control.html ./dist/
ENV NODE_ENV=production
ENV PORT=3978
ENV HOST=0.0.0.0
EXPOSE 3978
CMD ["node", "dist/index.js"]
