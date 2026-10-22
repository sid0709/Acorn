import { pinoRoot } from './pino-root';

/** Child logger tagged with a module name (service, worker, bootstrap). */
export function appLogger(module: string) {
  return pinoRoot.child({ module });
}
