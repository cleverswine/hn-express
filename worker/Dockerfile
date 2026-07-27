# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim

WORKDIR /app

# Copy manifests first (better layer caching). npm workspaces need every
# workspace's package.json present to validate against package-lock.json,
# even though this image only ships the worker + db source below.
COPY package.json package-lock.json ./
COPY db/package.json ./db/package.json
COPY web/package.json ./web/package.json
COPY worker/package.json ./worker/package.json

# Skip playwright's automatic browser download during npm ci — installed
# explicitly below so only this image (which actually needs it) pays for it.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

COPY db ./db
COPY worker ./worker

RUN npx playwright install --with-deps chromium

WORKDIR /app/worker
ENV NODE_ENV=production
CMD ["node", "index.js"]
