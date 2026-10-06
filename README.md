# Acorn

Chrome extension that fills job applications, the website those accounts sign in on, and the API both talk to.

This is a bun workspaces repo. One `node_modules` at the root, one version of each library in the root `package.json` catalog, Prettier on commit (`lint-staged`), and commitlint on the commit message. Use bun only.

| Workspace         | What it is                     | Run it                                                |
| ----------------- | ------------------------------ | ----------------------------------------------------- |
| `acorn-frontend`  | Website                        | `bun run dev:web` → http://localhost:6005             |
| `acorn-backend`   | API (`/acorn/*` and Socket.IO) | `bun run dev:acorn-api` → http://127.0.0.1:8083       |
| `acorn-extension` | Chrome extension               | `bun run dev:acorn`, then load `acorn/extension/dist` |

```bash
bun install
```

The API compiles against `backend-core` in this repo (`acorn-backend/go.mod` replaces it with `../backend-core`). Google sign-in is `packages/google-signin` (`@acorn/google-signin`).

`bun run format:check` is the Prettier check. `bun run lint` is ESLint.
