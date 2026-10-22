import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_TIMEOUT_MS =
  Number.parseInt(
    process.env.RESUME_TEMPLATE_PREVIEW_TIMEOUT_MS || '30000',
    10,
  ) || 30000;

export function candidatePaths(name: 'soffice' | 'pdftoppm'): string[] {
  const home = os.homedir();
  if (name === 'soffice') {
    return [
      process.env.SOFFICE_PATH,
      process.env.LIBREOFFICE_PATH,
      'soffice',
      'libreoffice',
      '/Applications/LibreOffice.app/Contents/MacOS/soffice',
      path.join(
        home,
        '.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/soffice',
      ),
    ].filter((v): v is string => Boolean(v));
  }
  return [
    process.env.PDFTOPPM_PATH,
    'pdftoppm',
    path.join(
      home,
      '.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pdftoppm',
    ),
  ].filter((v): v is string => Boolean(v));
}

function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          new Error(`${path.basename(command)} timed out after ${timeoutMs}ms`),
        );
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${path.basename(command)} exited with ${code}: ${stderr || stdout || 'no output'}`,
        ),
      );
    });
  });
}

export async function runWithCandidates(
  names: 'soffice' | 'pdftoppm',
  args: string[],
): Promise<void> {
  let lastError: unknown = null;
  for (const command of candidatePaths(names)) {
    try {
      await runCommand(command, args);
      return;
    } catch (err) {
      lastError = err;
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') break;
    }
  }
  throw lastError || new Error(`Could not find executable: ${names}`);
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
