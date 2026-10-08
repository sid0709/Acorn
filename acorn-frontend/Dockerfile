# Public origin for canonical links, the sitemap, and robots.txt. Also baked into the extension.
ARG VITE_ACORN_WEB_URL=https://acorn.remotepairnet.net

FROM oven/bun:1.4.2 AS build

WORKDIR /app

ENV HUSKY=0

COPY . .

RUN apt-get update \
  && apt-get install -y --no-install-recommends zip \
  && rm -rf /var/lib/apt/lists/*

RUN bun install --frozen-lockfile

# Extension zip for Apps → Download .zip (VITE_* from build args / acorn/.env).
ARG VITE_ACORN_API_URL=https://acornapi.remotepairnet.net
ARG VITE_ACORN_WEB_URL
ENV VITE_ACORN_API_URL=$VITE_ACORN_API_URL
ENV VITE_ACORN_WEB_URL=$VITE_ACORN_WEB_URL
ENV ACORN_WEB_URL=$VITE_ACORN_WEB_URL
RUN bun tools/extension-release.mjs

RUN bun run --filter acorn-frontend build

FROM node:20-bookworm-slim

ARG VITE_ACORN_WEB_URL

WORKDIR /app

ENV NODE_ENV=production
ENV ACORN_WEB_URL=$VITE_ACORN_WEB_URL
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=build /app/acorn-frontend/.next/standalone ./
COPY --from=build /app/acorn-frontend/.next/static ./acorn-frontend/.next/static
COPY --from=build /app/acorn-frontend/public ./acorn-frontend/public

EXPOSE 3000
CMD ["node", "acorn-frontend/server.js"]
