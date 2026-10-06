FROM oven/bun:1.4.2 AS build

WORKDIR /app

ENV HUSKY=0

COPY . .

RUN bun install --frozen-lockfile --filter acorn-frontend
RUN bun run --filter acorn-frontend build

FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=build /app/acorn-frontend/.next/standalone ./
COPY --from=build /app/acorn-frontend/.next/static ./acorn-frontend/.next/static

EXPOSE 3000
CMD ["node", "acorn-frontend/server.js"]
