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

The agent compiles against the shared packages of `acorn-backend` in this repo (`acorn-agent/go.mod` replaces the module with `../acorn-backend`). Google sign-in is `packages/google-signin` (`@acorn/google-signin`).

`bun run ci` is the GitHub CI check: Prettier, ESLint, dependencies, and `bun test`. `bun run ci:fix` writes Prettier and auto-fixable ESLint issues, including import order.
