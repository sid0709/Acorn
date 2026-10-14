import type { NextConfig } from "next";
import { readFileSync } from "node:fs";
import path from "node:path";

function extensionPackageVersion(): string {
  try {
    const pkgPath = path.join(__dirname, "../acorn/extension/package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    return String(pkg.version ?? "").trim();
  } catch {
    return "";
  }
}

const extensionVersion = extensionPackageVersion();

/** Revisits of a dynamic page within this window skip the server round trip. */
const DYNAMIC_ROUTE_CACHE_SECONDS = 30;
/** A prefetched route (a link's frame and loading state) stays warm this long. */
const PREFETCHED_ROUTE_CACHE_SECONDS = 180;

/** Gmail and Apps became one Connections page; old links and bookmarks still land there. */
const LEGACY_REDIRECTS = [
  { source: "/gmail", destination: "/connections", permanent: true },
  { source: "/gmail/connect", destination: "/connections/gmail", permanent: true },
  { source: "/apps", destination: "/connections", permanent: true },
];

const nextConfig: NextConfig = {
  env: extensionVersion ? { NEXT_PUBLIC_ACORN_EXTENSION_VERSION: extensionVersion } : undefined,
  experimental: {
    staleTimes: {
      dynamic: DYNAMIC_ROUTE_CACHE_SECONDS,
      static: PREFETCHED_ROUTE_CACHE_SECONDS,
    },
  },
  async redirects() {
    return LEGACY_REDIRECTS;
  },
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, ".."),
  transpilePackages: [
    "@acorn/app-theme",
    "@acorn/shared",
    "sid-ui",
    "@acorn/google-gmail",
    "@acorn/google-signin",
    "@astryxdesign/core",
    "@astryxdesign/theme-neutral",
    "@stylexjs/stylex",
  ],
};

export default nextConfig;
