// Serves the local multi-step application site the e2e run drives.
import { join } from "node:path";

/** Port of the local site; override with E2E_MOCK_PORT. */
export const MOCK_PORT_DEFAULT = 6111;
const SITE_DIR = join(import.meta.dir, "site");
/** Paths the single-page site draws itself; every one serves index.html. */
const APP_ROUTES = ["/job", "/apply", "/other-service"];

export function mockPort(): number {
  const port = Number(process.env.E2E_MOCK_PORT);
  return Number.isInteger(port) && port > 0 ? port : MOCK_PORT_DEFAULT;
}

export function startMockSite(port = mockPort()) {
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === "/" || APP_ROUTES.some((route) => pathname.startsWith(route))) {
        return new Response(Bun.file(join(SITE_DIR, "index.html")));
      }
      const file = Bun.file(join(SITE_DIR, pathname.replace(/^\/+/, "")));
      return (await file.exists())
        ? new Response(file)
        : new Response("Not found", { status: 404 });
    },
  });
}

if (import.meta.main) {
  const server = startMockSite();
  console.log(`Mock application site on http://127.0.0.1:${server.port}/job`);
}
