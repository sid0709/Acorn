import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json";
import pkg from "./package.json";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/** The one Oak version: package.json. The manifest, the side panel, and the build log all read it. */
const OAK_VERSION = pkg.version;

/** Prints the version being built, so every build log says which Oak it produced. */
function logOakVersion(): Plugin {
  return {
    name: "oak-version",
    configResolved(config) {
      config.logger.info(`\nOak extension v${OAK_VERSION} (${config.mode})\n`);
    },
  };
}

export default defineConfig({
  base: "./",
  define: {
    "import.meta.env.VITE_OAK_VERSION": JSON.stringify(OAK_VERSION),
  },
  plugins: [logOakVersion(), react(), crx({ manifest: { ...manifest, version: OAK_VERSION } })],
  resolve: {
    alias: {
      "@oak/shared": path.resolve(rootDir, "../shared"),
      "@oak/face": path.resolve(rootDir, "../packages/oak-face/src/index.ts"),
    },
  },
  server: {
    fs: { allow: [rootDir, path.resolve(rootDir, "..")] },
  },
  build: {
    // Chrome extension pages reject Vite modulepreload (cross-world mismatch warnings).
    modulePreload: false,
    rollupOptions: {
      input: {
        sidebar: "sidebar.html",
      },
    },
  },
});
