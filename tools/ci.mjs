// Local mirror of the Lint and format job in .github/workflows/ci.yml.
// `bun run ci` checks. `bun run ci:fix` writes Prettier and auto-fixable ESLint issues.
import { spawnSync } from "node:child_process";

const fix = process.argv.includes("--fix");

const steps = fix
  ? [
      ["format", ["bun", "run", "format"]],
      ["lint:fix", ["bun", "run", "lint:fix"]],
    ]
  : [
      ["format:check", ["bun", "run", "format:check"]],
      ["lint", ["bun", "run", "lint"]],
      ["check:deps", ["bun", "run", "check:deps"]],
      ["test", ["bun", "test"]],
    ];

const failed = [];

for (const [name, args] of steps) {
  console.log(`\n── ${name} ──\n`);
  const result = spawnSync(args[0], args.slice(1), { stdio: "inherit" });
  if (result.status !== 0) failed.push(name);
}

if (failed.length > 0) {
  console.error(`\nci failed: ${failed.join(", ")}`);
  process.exit(1);
}

console.log(fix ? "\nci:fix applied." : "\nci passed.");
