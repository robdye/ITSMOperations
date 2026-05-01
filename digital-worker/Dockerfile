FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
RUN apt-get update \
	&& apt-get install -y --no-install-recommends libicu-dev ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/mission-control.html ./dist/
ENV NODE_ENV=production
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=0
ENV PORT=3978
ENV HOST=0.0.0.0
EXPOSE 3978
CMD ["node", "dist/index.js"]
