import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

import sharedLintConfig from "./eslint.shared.mjs";

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/.next/**",
    "**/.turbo/**",
    "**/dist/**",
    "**/coverage/**",
  ]),
  ...sharedLintConfig,
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // These files stay out of the build tsconfig. Type-aware rules need a project, so skip them.
    files: [
      "**/extension/**/*.test.ts",
      "**/extension/vite.config.ts",
      "**/acorn-face/tools/**/*.ts",
    ],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: false,
      },
    },
  },
  {
    // node:test's describe/it return promises and consume them. The rule flags every case.
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
  {
    // Sheet player helpers are named use*; they are not React hooks.
    files: ["**/demo/**/*.js"],
    rules: {
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/rules-of-hooks": "off",
    },
  },
]);
