# Cloud Agent — Node HTTP server for Cloudflare Workers Containers.
# linux/amd64 required by Cloudflare Containers.
FROM --platform=linux/amd64 node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY . .
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["npx", "tsx", "src/server.ts"]
