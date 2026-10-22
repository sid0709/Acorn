# athens-backend logging

All process logs go through **Pino**. Local/dev uses **pino-pretty** with colored levels. Production writes JSON.

This file is the package logging rule. Follow it for every new or edited log line. Package engineering policy: [`policy-athens-backend.md`](policy-athens-backend.md).

## Setup

```ts
import pino from 'pino';

export const logger = pino(
  pino.transport({
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
      singleLine: true,
    },
  }),
);
```

Do not copy that snippet into feature files. Use the shared root:

```ts
import { appLogger } from '../common/logger/app-logger';

const log = appLogger(MyService.name);

log.debug({ jobId, attempt }, 'claim start');
log.info({ jobId, durationMs }, 'claim ok');
log.warn({ jobId, err: compact }, 'claim retry');
log.error({ jobId, err: compact }, 'claim failed');
```

`app.useLogger(new NestPinoLogger())` in `main.ts` also routes Nest `Logger` through the same Pino root (colored in the terminal). Prefer `appLogger` for new code so fields stay structured.

## Env

| Variable     | Default                                                  | Meaning                                                 |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------- |
| `LOG_LEVEL`  | `debug` when `NODE_ENV` is not `production`, else `info` | `trace` / `debug` / `info` / `warn` / `error` / `fatal` |
| `LOG_PRETTY` | pretty unless `NODE_ENV=production`                      | `true`/`false` to force pretty or JSON                  |

Pretty options match the snippet above (`colorize`, `SYS:standard` time, hide pid/hostname, single line).

Level colors in the terminal (pino-pretty):

- `DEBUG` — dim/gray
- `INFO` — default
- `WARN` — yellow
- `ERROR` — red

## What to log

Log **decisions, I/O, and outcomes**, not silence.

| Level   | Use for                                                                       |
| ------- | ----------------------------------------------------------------------------- |
| `debug` | Start of a unit of work, sizes, flags, HTTP 2xx, retry context                |
| `info`  | Successful completions that operators care about (LLM ok, listen, persist ok) |
| `warn`  | Retries, aborts, slow/degraded paths, HTTP 4xx                                |
| `error` | Failures after retries, HTTP 5xx, persist/transport hard failures             |

Every interesting event should include **fields**, then a short message:

- Identity: `module` (automatic on `appLogger`), `feature`, `path`, `requestId`, `runId`, `jobId`, `applierName` when known
- Timing: `durationMs`, `attempt`, `timeoutMs`, `backoffMs`
- LLM: `provider`, `model`, `billedModel`, `messageCount`, `promptChars`, token counts — **never** prompt text, completions, or API keys
- HTTP: `method`, `path` (no query string), `status`, `durationMs`. GET 2xx is `debug`; mutating 2xx is `info`; 4xx `warn`; 5xx `error`.
- Errors: `errName`, truncated `err` (`compactError`), `httpStatus`, `retryable`

## Never log

- API keys, passwords, Bearer tokens, `Authorization` headers, connection strings
- Full LLM prompts, completions, job descriptions, resume bodies, email bodies
- Query strings (tokens sometimes live there)

## Do not

- `console.log` / `console.warn` / `console.error`
- `new Logger()` from `@nestjs/common` in new code (existing Nest loggers still work via `NestPinoLogger`)
- A second Pino instance or a different pretty printer
- Log-and-swallow: if you catch, log with fields, then rethrow or handle

## Files

| File                                          | Role                                 |
| --------------------------------------------- | ------------------------------------ |
| `src/common/logger/pino-root.ts`              | Process-wide Pino + pretty transport |
| `src/common/logger/app-logger.ts`             | `appLogger(module)` children         |
| `src/common/logger/nest-pino.logger.ts`       | Nest `LoggerService` adapter         |
| `src/common/logger/http-access.middleware.ts` | Per-request HTTP lines               |
