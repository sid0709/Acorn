# Acorn — agent instructions

This is a **bun workspaces monorepo**. Work from the repo root. Shared UI is the `sid-ui` package (https://github.com/sid0709/sid-ui). Apps consume it from the catalog. Do not copy a component, token, or helper into a workspace, and do not add the source back under `packages/`.

Workspaces: `acorn-frontend`, `acorn/extension`, `acorn/packages/*`, `acorn/demo`, `packages/google-signin`, and the Go module `acorn-backend`. The component catalog is `sid-ui-theme` in the sid-ui repo.

`acorn-backend` uses Joined's `backend-core` via the `replace` in `acorn-backend/go.mod` (`../../Joined/backend-core`, relative to that module). `@joined/google-signin` re-exports the same checkout's `packages/google-signin`. Keep the Joined checkout as a sibling of this repo.

Before pushing, run `bun run format:check` and `bun run lint`.

## Package manager

Use **bun only**. Never npm, yarn, or pnpm.

```bash
bun install
bun add <pkg>
bun add -d <pkg>
bun run <script>
bunx <cli>
```

Do not create or commit `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`. Prefer `bun.lock`.

If a launch/debug config still calls `npm`, switch it to `bun`.

## No hardcoding

Never inline a value that belongs in env, a config module, a design token, or a named constant. This applies in every language. The stack rule for the files you are editing says where that value lives.

- Secrets and API hosts come from the environment or that stack's config module. A literal host or key in source is a bug.
- Colors, spacing, type, radii, and shadows in UI come from `sid-ui` tokens. A hex color or an inline style for those is a bug.
- Timeouts, limits, ids, and protocol strings are named constants in the module that owns them.
- A value used by more than one workspace lives in one shared package.

User-facing copy can sit next to the only component that shows it. Copy used in a second place moves to a shared constant.

## Stack rules

Follow the rule that matches the folder you are editing, and use only that folder's stack. The files in `.claude/rules/` are mandatory. Cursor loads the same text from `.cursor/rules/`.

| Folder | Rule |
| --- | --- |
| Next.js: `acorn-frontend` | `.claude/rules/nextjs.md` |
| UI on `sid-ui`: `acorn-frontend`, `acorn/extension` | `.claude/rules/design-system.md` |
| Go: `acorn-backend` | `.claude/rules/go.md` |
| Vite: `acorn/extension`, `acorn/demo`, `acorn/packages` | `.claude/rules/vite.md` |

Acorn's rules in `acorn/.claude/CLAUDE.md` and `acorn/.cursor/rules/` still apply on top of these.

## Best practice

- Match the neighboring files in that workspace before introducing a new pattern.
- Prefer composition and reuse over duplication.
- Keep modules small and single-purpose. Split a file when it mixes unrelated concerns or grows past a focused unit of work.
- Colocate types with the code that owns them; share types from packages when more than one app needs them.
- Change the source of truth (tokens, shared components, config) instead of patching call sites with one-off values.
