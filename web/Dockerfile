# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim

WORKDIR /app

# Copy manifests first (better layer caching). npm workspaces need every
# workspace's package.json present to validate against package-lock.json,
# even though this image only ships the web + db source below.
COPY package.json package-lock.json ./
COPY db/package.json ./db/package.json
COPY web/package.json ./web/package.json
COPY worker/package.json ./worker/package.json

# This image never uses playwright (that's worker-only), but the package is
# in the shared lockfile — skip its browser download here regardless.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

COPY db ./db
COPY web ./web

WORKDIR /app/web
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "index.js"]
