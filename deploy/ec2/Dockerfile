# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.10.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY engine/package.json engine/tsconfig.json engine/build.mjs ./engine/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --filter @clutch/engine... --frozen-lockfile
COPY engine/src ./engine/src
COPY engine/fixtures ./engine/fixtures
COPY packages/shared/src ./packages/shared/src
RUN pnpm --filter @clutch/engine typecheck && pnpm --filter @clutch/engine build \
 && pnpm --filter @clutch/engine deploy --prod --legacy /runtime

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-venv tini \
 && python3 -m venv /opt/capture \
 && /opt/capture/bin/pip install --no-cache-dir streamlink==8.6.3 \
 && rm -rf /var/lib/apt/lists/*
ENV PATH=/opt/capture/bin:$PATH
ENV NODE_ENV=production CHAIN_ID=84532 REPLAY=0 DATA_DIR=/app/engine/data PORT=8787
WORKDIR /app/engine
COPY --from=build --chown=node:node /runtime/ ./
COPY --chown=node:node contracts/deployments/84532.json /app/contracts/deployments/84532.json
COPY deploy/ec2/healthcheck.mjs /app/healthcheck.mjs
RUN mkdir -p /app/engine/data && chown node:node /app/engine/data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=6s --start-period=120s --retries=3 CMD ["node", "/app/healthcheck.mjs"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.mjs"]
