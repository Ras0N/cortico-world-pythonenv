import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runOnHost } from './host-run.ts';
import { VENV_DIR } from './layout.ts';
import {
  mirrorPythonDllsIntoVenv,
  venvPipPath,
  venvPythonPath,
} from './python-home.ts';

/**
 * Debian/Ubuntu 系统 Python 默认不带 ensurepip（不是业务漏 import）。
 * 安装：`sudo apt install python3-venv python3-pip`
 */
export const LINUX_VENV_APT_HINT =
  'Debian/Ubuntu system Python has no ensurepip module. Install: sudo apt update && sudo apt install -y python3-venv python3-pip';

export interface HostVenvBootstrapOpts {
  workDirAbs: string;
  hostPythonAbs: string;
  env: Record<string, string>;
  timeoutMs: number;
  onLog?: (msg: string, data?: unknown) => void;
}

export interface HostVenvBootstrapResult {
  venvPython: string;
  venvPip: string;
  /** true = `python -m venv` 一次带上 pip（Linux 常见）。 */
  pipViaVenvModule: boolean;
}

/**
 * 宿主上创建 workDir/venv 并保证 pip 可用。
 * - Linux：`python -m venv`（依赖 python3-venv）；缺 ensurepip 时抛出 apt 提示。
 * - Windows：`venv --without-pip` + `ensurepip` + 镜像 DLL。
 */
export async function bootstrapVenvOnHost(opts: HostVenvBootstrapOpts): Promise<HostVenvBootstrapResult> {
  const { workDirAbs, hostPythonAbs, env, timeoutMs, onLog } = opts;
  const root = join(workDirAbs, VENV_DIR);
  const venvPython = venvPythonPath(root);
  const venvPip = venvPipPath(root);
  const q = quoteCmd;

  if (process.platform === 'linux') {
    const createCmd = `${q(hostPythonAbs)} -m venv ${VENV_DIR}`;
    onLog?.('creating venv on host (with pip)', { createCmd });
    const created = await runOnHost({ command: createCmd, cwd: workDirAbs, env, timeoutMs });
    if (created.exitCode !== 0 || !existsSync(venvPython)) {
      const detail = `${created.stderr}\n${created.stdout}`;
      if (/ensurepip|No module named ensurepip/i.test(detail)) {
        throw new Error(`failed to create venv on host: ${detail.trim()}\n${LINUX_VENV_APT_HINT}`);
      }
      throw new Error(`failed to create venv on host (exit ${created.exitCode}): ${detail}`);
    }
    if (!existsSync(venvPip)) {
      const pipCmd = `${q(venvPython)} -m ensurepip --upgrade --default-pip`;
      onLog?.('venv missing pip; trying ensurepip', { pipCmd });
      const ensured = await runOnHost({ command: pipCmd, cwd: workDirAbs, env, timeoutMs });
      if (ensured.exitCode !== 0 || !existsSync(venvPip)) {
        throw new Error(
          `failed to bootstrap pip on host: ${(ensured.stderr || ensured.stdout).trim()}\n${LINUX_VENV_APT_HINT}`,
        );
      }
      return { venvPython, venvPip, pipViaVenvModule: false };
    }
    return { venvPython, venvPip, pipViaVenvModule: true };
  }

  const createCmd = `${q(hostPythonAbs)} -m venv --without-pip ${VENV_DIR}`;
  onLog?.('creating venv on host (without-pip)', { createCmd });
  const created = await runOnHost({ command: createCmd, cwd: workDirAbs, env, timeoutMs });
  if (created.exitCode !== 0 || !existsSync(venvPython)) {
    throw new Error(
      `failed to create venv on host (exit ${created.exitCode}): ${created.stderr}\n${created.stdout}`,
    );
  }
  const copied = mirrorPythonDllsIntoVenv(hostPythonAbs, root);
  onLog?.('mirrored Python DLLs into venv', { copied });

  const pipCmd = `${q(venvPython)} -m ensurepip --upgrade --default-pip`;
  onLog?.('bootstrapping pip via ensurepip', { pipCmd });
  const ensured = await runOnHost({ command: pipCmd, cwd: workDirAbs, env, timeoutMs });
  if (ensured.exitCode !== 0 || !existsSync(venvPip)) {
    throw new Error(
      `failed to bootstrap pip on host (exit ${ensured.exitCode}): ${ensured.stderr}\n${ensured.stdout}`,
    );
  }
  return { venvPython, venvPip, pipViaVenvModule: false };
}

function quoteCmd(s: string): string {
  if (!/[ \t"]/g.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}
