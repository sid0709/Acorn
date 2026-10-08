// Production extension build for deploy: apply VITE_* env, build, zip for the Apps page.
import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(repoRoot, "acorn", "extension");
const distDir = path.join(extensionDir, "dist");
const envPath = path.join(repoRoot, "acorn", ".env");
const extensionPkgPath = path.join(extensionDir, "package.json");

const VITE_KEYS = ["VITE_ACORN_API_URL", "VITE_ACORN_WEB_URL", "VITE_ACORN_AUTO_FOCUS_SECONDS"];

function parseArgs(argv) {
  let zipOut = path.join(repoRoot, "acorn-frontend", "public", "downloads", "acorn-chrome.zip");
  let nextEnvOut = path.join(repoRoot, "acorn-frontend", ".env.production.local");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--zip" && argv[i + 1]) zipOut = path.resolve(argv[++i]);
    if (argv[i] === "--next-env" && argv[i + 1]) nextEnvOut = path.resolve(argv[++i]);
  }
  return { zipOut, nextEnvOut };
}

async function loadEnvFile(filePath) {
  const file = Bun.file(filePath);
  if (!(await file.exists())) return {};
  const text = await file.text();
  const values = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return values;
}

async function writeExtensionEnv() {
  const merged = await loadEnvFile(envPath);
  for (const key of VITE_KEYS) {
    const fromProcess = process.env[key]?.trim();
    if (fromProcess) merged[key] = fromProcess;
  }
  const lines = Object.entries(merged).filter(([key]) => VITE_KEYS.includes(key));
  if (lines.length === 0) {
    console.log("extension-release: no VITE_* overrides; Vite uses production defaults");
    return;
  }
  const body = `${lines.map(([k, v]) => `${k}=${v}`).join("\n")}\n`;
  await Bun.write(envPath, body);
  console.log(
    `extension-release: wrote ${path.relative(repoRoot, envPath)} (${lines.length} keys)`,
  );
}

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function zipDist(outZip) {
  await mkdir(path.dirname(outZip), { recursive: true });
  run("zip", ["-qr", outZip, "."], distDir);
  console.log(`extension-release: ${path.relative(repoRoot, outZip)}`);
}

async function writeNextExtensionVersion(nextEnvOut) {
  const pkg = await Bun.file(extensionPkgPath).json();
  const version = String(pkg.version ?? "").trim();
  if (!version) {
    console.error("extension-release: missing version in acorn/extension/package.json");
    process.exit(1);
  }
  await mkdir(path.dirname(nextEnvOut), { recursive: true });
  await Bun.write(nextEnvOut, `NEXT_PUBLIC_ACORN_EXTENSION_VERSION=${version}\n`);
  console.log(`extension-release: Apps page version ${version}`);
}

const { zipOut, nextEnvOut } = parseArgs(process.argv.slice(2));

await writeExtensionEnv();
run("bun", ["run", "--filter", "acorn-extension", "build"]);
await zipDist(zipOut);
await writeNextExtensionVersion(nextEnvOut);
