# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22.15-bookworm-slim

FROM node:${NODE_VERSION} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo
# A URL pública da API é embutida no bundle do navegador no momento do build.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@sci/web...

FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN groupadd -r sci && useradd -r -g sci sci
COPY --from=build --chown=sci:sci /repo/apps/web/.next/standalone ./
COPY --from=build --chown=sci:sci /repo/apps/web/.next/static ./apps/web/.next/static
USER sci
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
