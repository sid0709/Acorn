// Production extension builds for deploy: apply VITE_* env, build, zip for the Connections page.
// Two extensions: Acorn (a workspace) and Oak (oak-agent, its own Bun project).
import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(repoRoot, "acorn", "extension");
const distDir = path.join(extensionDir, "dist");
const envPath = path.join(repoRoot, "acorn", ".env");
const extensionPkgPath = path.join(extensionDir, "package.json");

const VITE_KEYS = ["VITE_ACORN_API_URL", "VITE_ACORN_WEB_URL"];

const oakDir = path.join(repoRoot, "oak-agent");
const oakDistDir = path.join(oakDir, "extension", "dist");
const oakExtensionPkgPath = path.join(oakDir, "extension", "package.json");

function parseArgs(argv) {
  let zipOut = path.join(repoRoot, "acorn-frontend", "public", "downloads", "acorn-chrome.zip");
  let oakZipOut = path.join(repoRoot, "acorn-frontend", "public", "downloads", "oak-chrome.zip");
  let nextEnvOut = path.join(repoRoot, "acorn-frontend", ".env.production.local");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--zip" && argv[i + 1]) zipOut = path.resolve(argv[++i]);
    if (argv[i] === "--oak-zip" && argv[i + 1]) oakZipOut = path.resolve(argv[++i]);
    if (argv[i] === "--next-env" && argv[i + 1]) nextEnvOut = path.resolve(argv[++i]);
  }
  return { zipOut, oakZipOut, nextEnvOut };
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

async function zipDist(outZip, fromDir = distDir) {
  await mkdir(path.dirname(outZip), { recursive: true });
  run("zip", ["-qr", outZip, "."], fromDir);
  console.log(`extension-release: ${path.relative(repoRoot, outZip)}`);
}

async function readVersion(pkgPath) {
  const pkg = await Bun.file(pkgPath).json();
  const version = String(pkg.version ?? "").trim();
  if (!version) {
    console.error(`extension-release: missing version in ${path.relative(repoRoot, pkgPath)}`);
    process.exit(1);
  }
  return version;
}

async function writeNextExtensionVersions(nextEnvOut) {
  const acornVersion = await readVersion(extensionPkgPath);
  const oakVersion = await readVersion(oakExtensionPkgPath);
  await mkdir(path.dirname(nextEnvOut), { recursive: true });
  await Bun.write(
    nextEnvOut,
    `NEXT_PUBLIC_ACORN_EXTENSION_VERSION=${acornVersion}\nNEXT_PUBLIC_OAK_EXTENSION_VERSION=${oakVersion}\n`,
  );
  console.log(
    `extension-release: Connections page versions acorn ${acornVersion}, oak ${oakVersion}`,
  );
}

/** Oak is its own Bun project: install its dependencies, then build it against the production API. */
function buildOak() {
  // Oak talks to oak-backend, which nginx serves on the same host as the Acorn API.
  const apiUrl = process.env.VITE_OAK_API_URL?.trim() || process.env.VITE_ACORN_API_URL?.trim();
  const env = apiUrl ? { ...process.env, VITE_OAK_API_URL: apiUrl } : process.env;
  const step = (args) => {
    const result = spawnSync("bun", args, { cwd: oakDir, stdio: "inherit", env });
    if (result.status !== 0) process.exit(result.status ?? 1);
  };
  step(["install", "--frozen-lockfile"]);
  step(["run", "--filter", "oak-extension", "build"]);
}

const { zipOut, oakZipOut, nextEnvOut } = parseArgs(process.argv.slice(2));

await writeExtensionEnv();
run("bun", ["run", "--filter", "acorn-extension", "build"]);
await zipDist(zipOut);
buildOak();
await zipDist(oakZipOut, oakDistDir);
await writeNextExtensionVersions(nextEnvOut);
