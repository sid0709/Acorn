import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, ".."),
  experimental: {
    // Keep visited and prefetched pages for this many seconds, so going back to a tab is instant.
    staleTimes: { dynamic: 30 },
  },
  transpilePackages: [
    "@acorn/app-theme",
    "@acorn/support-chat",
    "sid-ui",
    "@astryxdesign/core",
    "@astryxdesign/theme-neutral",
    "@stylexjs/stylex",
  ],
};

export default nextConfig;
