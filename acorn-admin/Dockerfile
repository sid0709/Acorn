FROM oven/bun:1.4.2 AS build

WORKDIR /app

ENV HUSKY=0

COPY . .

RUN bun install --frozen-lockfile --filter acorn-admin
RUN bun run --filter acorn-admin build

FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=build /app/acorn-admin/.next/standalone ./
COPY --from=build /app/acorn-admin/.next/static ./acorn-admin/.next/static

EXPOSE 3000
CMD ["node", "acorn-admin/server.js"]
