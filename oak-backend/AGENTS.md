# oak-backend agent instructions

NestJS service for the Oak extension, on Acorn's MongoDB. Use **bun** only (`bun install`, `bun run build`, `bun run lint`).

- All Acorn data goes through `src/acorn/`. Collection names, env reads and defaults live in `acorn.constants.ts`; a service never inlines them.
- Secrets (`ACORN_MONGO_URI`, model keys) come from the environment or the signed-in profile. Never log or return a profile key, password or token.
- Prompts built from the profile use the saved fields as they are. Do not add per-site or per-wording rules.
- Logging uses Pino through `appLogger`.
- Verify with `bun run build` and `bunx tsc --noEmit`.
