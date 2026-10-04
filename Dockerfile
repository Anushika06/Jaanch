# syntax=docker/dockerfile:1.7
# Jaanch: one image serving the API, the WhatsApp webhook, the background worker and the web app.

# ---------------------------------------------------------------- build
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable

# Install dependencies first (cached unless manifests change).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/llm/package.json packages/llm/
COPY packages/sources/package.json packages/sources/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @jaanch/web build \
 && pnpm --filter @jaanch/server build \
 && pnpm --filter @jaanch/server deploy --prod --legacy /out

# ---------------------------------------------------------------- runtime
FROM node:22-slim
# ffmpeg converts browser voice recordings for speech recognition.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    WEB_DIST_DIR=/app/web \
    RIVA_PROTO_DIR=/app/dist/protos
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/web/dist ./web
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
