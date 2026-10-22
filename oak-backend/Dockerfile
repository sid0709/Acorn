# Build context is the Acorn repo. oak-backend is its own Bun project (not a root workspace).
FROM oven/bun:1.4.2 AS build

WORKDIR /app

COPY oak-backend/package.json oak-backend/bun.lock ./
RUN bun install --frozen-lockfile

COPY oak-backend/ ./
RUN bun run build

# Only what runs: production dependencies and the compiled output.
RUN rm -rf node_modules && bun install --frozen-lockfile --production

FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8094

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./

USER node
EXPOSE 8094
CMD ["node", "dist/main.js"]
