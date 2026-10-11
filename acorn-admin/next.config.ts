import path from "node:path";

import type { NextConfig } from "next";

/**
 * The middleware buffers each request body up to this size and cuts off the rest. A claim
 * message carries up to four 8 MB images (support.MaxAttachments × MaxAttachmentBytes).
 */
const MAX_REQUEST_BODY = "40mb";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, ".."),
  experimental: {
    // Keep visited and prefetched pages for this many seconds, so going back to a tab is instant.
    staleTimes: { dynamic: 30 },
    proxyClientMaxBodySize: MAX_REQUEST_BODY,
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
