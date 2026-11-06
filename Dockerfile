# Clutch engine: the long-running service (stream capture, 0G readers, market agent, resolver, API + WebSocket).
# Build from the repo root:  docker build -t clutch-engine .
# It needs ffmpeg + streamlink to read live video, and a persistent volume at /data for its SQLite database.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates \
 && pip3 install --no-cache-dir --break-system-packages streamlink \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.10.0 --activate
WORKDIR /repo

# Workspace manifests first, so dependency installs are cached between code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY engine/package.json engine/
RUN pnpm install --frozen-lockfile --filter @clutch/engine...

COPY packages/shared packages/shared
COPY engine engine
COPY contracts/deployments contracts/deployments

ENV NODE_ENV=production DATA_DIR=/data PORT=8787
VOLUME /data
EXPOSE 8787
WORKDIR /repo/engine
CMD ["npx", "tsx", "src/main.ts"]
