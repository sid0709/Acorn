// Every shipped change to the Oak extension bumps its version (oak-agent/.claude/CLAUDE.md).
// Usage: bun tools/check-oak-version.mjs [<base commit>]
// With a base commit, a change under oak-agent/ other than docs and tests must raise the version in
// oak-agent/extension/package.json. Always: manifest.json must not hold a version of its own.
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG = "oak-agent/extension/package.json";
const MANIFEST = "oak-agent/extension/manifest.json";
const EMPTY_SHA = /^0+$/;
/** Changes that do not ship in the extension. */
const NOT_SHIPPED = [
  /\.md$/,
  /\.mdc$/,
  /\.test\.[cm]?[jt]sx?$/,
  /^oak-agent\/\.claude\//,
  /^oak-agent\/\.cursor\//,
  /^oak-agent\/docs\//,
  /^oak-agent\/ui-board\//,
];

function git(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  return result.status === 0 ? result.stdout : null;
}

function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(text ?? "").trim());
  return match ? match.slice(1).map(Number) : null;
}

function isHigher(next, prev) {
  for (let i = 0; i < 3; i++) {
    if (next[i] !== prev[i]) return next[i] > prev[i];
  }
  return false;
}

const failures = [];
const manifest = JSON.parse(await readFile(path.join(repoRoot, MANIFEST), "utf8"));
if ("version" in manifest) {
  failures.push(`${MANIFEST} holds a version; it lives only in ${PKG}`);
}
const current = JSON.parse(await readFile(path.join(repoRoot, PKG), "utf8")).version;
const currentVersion = parseVersion(current);
if (!currentVersion) failures.push(`${PKG} version "${current}" is not x.y.z`);

const base = (process.argv[2] ?? "").trim();
if (base && !EMPTY_SHA.test(base) && currentVersion) {
  const changed = git(["diff", "--name-only", base, "HEAD", "--", "oak-agent"]);
  if (changed === null) {
    console.log(`check-oak-version: base ${base} is not available; skipping the bump check`);
  } else {
    const shipped = changed
      .split("\n")
      .filter(Boolean)
      .filter((file) => !NOT_SHIPPED.some((pattern) => pattern.test(file)));
    if (shipped.length > 0) {
      const before = git(["show", `${base}:${PKG}`]);
      const prevVersion = before ? parseVersion(JSON.parse(before).version) : null;
      if (prevVersion && !isHigher(currentVersion, prevVersion)) {
        failures.push(
          `oak-agent changed (${shipped.length} file(s), e.g. ${shipped[0]}) but ${PKG} is still ${prevVersion.join(".")}; bump it`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`check-oak-version: Oak extension v${current}`);
