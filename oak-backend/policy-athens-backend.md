# athens-backend Engineering Policy

Read this file before planning, editing, or reviewing changes in this package. Treat it as acceptance criteria for NestJS + Prisma work.

Parent product rules in the monorepo [`../rule.md`](../rule.md) still apply for Athens domain behavior (resume truth, skill coverage, state boundaries). This file covers **backend code shape and engineering practice**.

---

## 1. Stack and verification (no automated tests)

- Stack: NestJS modules/controllers/services + Prisma Client against MongoDB (`AthensDB`).
- Prefer TypeScript strictness, DTOs with `class-validator`, and Prisma-generated types over writing unit/e2e/Jest suites.
- **Do not add test files** (`*.spec.ts`, `*.test.ts`, `test/`, Jest config expansions) unless the user explicitly asks.
- Verification before considering work done: `npm run build` (and `npm run lint` when touching shared patterns). If it typechecks and builds, treat that as the default safety net.
- Do not invent runtime “safety” by adding mock-heavy tests; fix types, contracts, and validation instead.

---

## 2. Small files and folder structure

Hate large files. Split early.

### Size guidance

- Prefer **~150 lines or fewer** per `.ts` file. Soft ceiling **~250 lines**. Above that, split before adding more behavior.
- One primary responsibility per file. If a file needs a table of contents to navigate, it is already too big.

### Module layout

Feature code lives under `src/<feature>/` with thin, named pieces:

```text
src/<feature>/
  <feature>.module.ts
  <feature>.controller.ts          # HTTP only: validate in, map out, call services
  <feature>.service.ts             # orchestration for this feature (keep thin)
  dto/
    <action>.dto.ts                # one DTO family per file when growing
  <concern>.service.ts             # split by concern when the main service grows
  mappers/                         # optional: Prisma/row → API shape
  constants/                       # optional: named protocol constants (see §3)
```

Shared Nest wiring:

```text
src/prisma/          # PrismaModule / PrismaService only
src/common/          # filters, pipes, guards, interceptors used by >1 feature
```

### Split triggers (do this immediately)

| Smell                                              | Split into                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| Controller has business rules or Prisma calls      | service / mapper                                                      |
| Service mixes auth, hashing, and DB access         | `*.service.ts` per concern                                            |
| One DTO file holds many unrelated request shapes   | one file per request/response group                                   |
| Long `switch` / status maps / error message tables | `constants/` or dedicated mapper                                      |
| Prisma queries duplicated across features          | shared repository-style service under the owning feature or `common/` |

Do not create deep abstraction layers “for later.” Split for clarity, not for ceremony.

---

## 3. Hardcoding — definition and what to avoid

### What “hardcoding” means here

**Hardcoding** is embedding **environment-specific, customer-specific, or changeable business/domain values** directly in executable logic so that a product or data change requires editing scattered source files.

Examples of hardcoding to **avoid**:

| Avoid                                                                                              | Why                                                    | Prefer                                                                  |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| Connection strings, hosts, ports, API keys, secrets in source                                      | Environment-specific; leak risk                        | `process.env` / ConfigModule; document in `.env.example`                |
| Magic numbers with silent meaning (`if (tier === 3)`, `cost = 10` inline everywhere)               | Opaque; drift across call sites                        | Named constant in one module, or config                                 |
| Domain vocabulary lists in code (skills, vendors, industries, employers, keyword allow/deny lists) | Product data; duplicates parent `rule.md` violations   | Structured inputs, DB/schema, or injected contracts                     |
| Copy-pasted success/error strings across handlers with slight wording drift                        | Contract drift; hard to keep Athens clients compatible | One response mapper / shared message constants for **protocol** wording |
| Collection/field names re-invented as string literals outside Prisma                               | Schema drift                                           | Prisma model/client; `@map` lives in `schema.prisma` only               |
| Feature flags or “temporary” `if (name === 'demo')` special cases                                  | Silent product forks                                   | Explicit config or data-driven flags                                    |
| Assumed defaults that contradict Athens-server / client contracts                                  | Breaks clients                                         | Shared contract docs + typed DTOs matching the published API            |

### What is **not** hardcoding (allowed)

These are **protocol and structural constants**. They define the product API or Nest wiring, not domain vocabulary:

- HTTP paths that implement a published contract (e.g. `/auth/signin`) when kept in the controller decorators as the single source of truth for that route.
- DTO property names and Prisma field names that mirror the agreed API/DB schema.
- Enum-like status values that **are** the API contract (`success`, permission tier strings the client already depends on), preferably as `as const` / shared constants used everywhere.
- Nest metadata: injection tokens, module imports, guard names.
- One bcrypt cost (or similar) defined **once** next to the hashing helper, matching the legacy Athens-server contract — not re-typed as `10` in five places.

**Rule of thumb:** if changing a value would mean “deploy a code change to support a new customer/job/skill,” it is hardcoding — move it to data, config, or schema. If changing it would mean “version the public API,” a named constant or DTO field is fine.

### One source of truth

- Database shape: `prisma/schema.prisma` only. Do not parallel-define the same model in ad-hoc interfaces unless mapping an external legacy shape.
- Env keys: listed in `.env.example` with no secrets; read through one config path.
- API request/response shapes: DTOs + thin mappers; do not build response objects with anonymous littered field lists in every method if the shape is shared.
- Parent domain rules (resume/skills): follow monorepo `rule.md`; do not re-encode those policies as backend allowlists.

---

## 4. NestJS practice

- **Controllers:** parse/validate input (DTOs + ValidationPipe), call one service method, return the API shape. No Prisma, no bcrypt, no business branching beyond trivial HTTP mapping.
- **Services:** own use-cases. Inject `PrismaService` and other feature services; keep methods short; extract helpers when a method exceeds ~40 lines of real logic.
- **Modules:** export only what other features need. Import `PrismaModule` where persistence is required.
- **DTOs:** use `class-validator` / `class-transformer`. Reject unknown bad input at the edge; do not trust raw `req.body`.
- **Errors:** use Nest HTTP exceptions or a shared filter for Athens-compatible `{ success, message, ... }` envelopes. Do not `console.log` as error handling — use `appLogger` ([`LOGGING.md`](LOGGING.md)).
- **Async:** always `await` Prisma and I/O; no floating promises.
- **DI:** constructor injection only; no service locators or `new PrismaClient()` outside `PrismaService`.

---

## 5. Prisma practice

- Access the DB only through `PrismaService` (or a thin feature repository that wraps it). Never construct a second `PrismaClient` in feature code.
- Prefer Prisma’s typed queries over raw queries. Use raw only when Prisma cannot express the operation; keep raw SQL/Mongo fragments in one place.
- Schema changes: update `schema.prisma`, run `prisma generate`, then adjust DTOs/mappers. For Mongo, follow the project’s migrate/push workflow documented in README — do not invent parallel schemas.
- Map `_id` / ObjectId carefully for Athens-compatible responses (`_id` in JSON when the contract requires it).
- Do not put business rules inside Prisma middleware unless there is a clear cross-cutting persistence invariant.
- Keep Prisma model names and `@@map` collection names aligned with existing AthensDB collections when compatibility matters.

---

## 6. Security and secrets

- Never commit `.env`, credentials, or real connection strings.
- Hash passwords with the shared hashing helper; never store plaintext.
- Do not log passwords, tokens, API keys, full connection URLs, LLM prompts, or completions.
- Validate and bound inputs (length, required fields) at DTO level.

---

## 7. Change discipline

- Touch only files required for the task; preserve unrelated working-tree edits.
- Match existing naming and response envelopes when extending Athens-compatible routes.
- Prefer deleting dead code over commenting it out.
- When a feature grows, restructure folders in the same PR rather than leaving a 400-line service “for later.”
- After structural or public-contract changes, update this package’s `README.md` if setup, scripts, or routes changed.

---

## 8. Logging (Pino)

All logs go through the shared Pino root (`src/common/logger/`). Local/dev uses **pino-pretty** with colored levels (`colorize: true`). Do not add `console.log` or a second logger.

- New code: `appLogger(Module.name)` with structured fields, then a short message.
- Never log secrets, API keys, prompt text, or completions.
- Full rule: [`LOGGING.md`](LOGGING.md).

---

## 9. Quick checklist (before finishing a change)

- [ ] Files stayed small; new concerns got new files/folders
- [ ] No new domain/env hardcoding (§3)
- [ ] Controllers thin; services typed; Prisma only via `PrismaService`
- [ ] DTOs validate inputs; response shape matches published contract
- [ ] No new test suites added by default
- [ ] Logs use `appLogger` / Pino (no `console.*`); no secrets or prompt text ([`LOGGING.md`](LOGGING.md))
- [ ] `npm run build` succeeds
