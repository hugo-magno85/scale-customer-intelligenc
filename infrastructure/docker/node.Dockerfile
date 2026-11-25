# syntax=docker/dockerfile:1.7
# Imagem para apps Node do monorepo (api, worker). Uso:
#   docker build -f infrastructure/docker/node.Dockerfile --build-arg APP=api -t sci-api .
ARG NODE_VERSION=22.15-bookworm-slim

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS build
ARG APP
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@sci/${APP}...
RUN pnpm --filter=@sci/${APP} deploy --prod --legacy /out \
 && cp -r packages/db/migrations /out/migrations

FROM node:${NODE_VERSION} AS runtime
ARG APP
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd -r sci && useradd -r -g sci sci
COPY --from=build --chown=sci:sci /out /app
USER sci
EXPOSE 4000 4100
CMD ["node", "dist/server.js"]
