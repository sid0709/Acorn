import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, ".."),
  transpilePackages: [
    "@acorn/shared",
    "sid-ui",
    "@joined/google-signin",
    "@astryxdesign/core",
    "@astryxdesign/theme-neutral",
    "@stylexjs/stylex",
  ],
};

export default nextConfig;
