import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * 在宿主上解析 Python 可执行文件的绝对路径（不进沙箱）。
 * Windows：`where.exe`；Linux：`command -v`（经 `sh -c`）。
 */
export function resolveHostPythonExecutable(
  configured: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const trimmed = configured.trim();
  if (trimmed && (isAbsolute(trimmed) || existsSync(trimmed))) {
    return resolve(trimmed);
  }
  const candidates =
    platform === 'win32'
      ? [trimmed || 'python', 'python', 'py']
      : [trimmed || 'python3', 'python3', 'python'];

  for (const name of candidates) {
    if (!name) continue;
    const found = lookupOnPath(name, platform);
    if (found) return found;
  }
  return trimmed || (platform === 'win32' ? 'python' : 'python3');
}

function lookupOnPath(name: string, platform: NodeJS.Platform): string | undefined {
  try {
    if (platform === 'win32') {
      const out = execFileSync('where.exe', [name], { encoding: 'utf8', windowsHide: true });
      const first = out
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find((s) => s && existsSync(s));
      return first ? resolve(first) : undefined;
    }
    const out = execFileSync('/bin/sh', ['-c', `command -v -- ${shellQuote(name)}`], {
      encoding: 'utf8',
    });
    const first = out.trim().split(/\r?\n/)[0]?.trim();
    if (first && existsSync(first)) return resolve(first);
  } catch {
    /* fall through */
  }
  return undefined;
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function pythonPrefixOf(pythonExecutable: string): string | undefined {
  if (!pythonExecutable || !existsSync(pythonExecutable)) return undefined;
  let dir = dirname(resolve(pythonExecutable));
  const leaf = basename(dir).toLowerCase();
  // Windows: .../Python315/Scripts/python.exe → prefix Python315
  // Linux venv: .../venv/bin/python → prefix venv
  if (leaf === 'scripts' || leaf === 'bin') dir = dirname(dir);
  return dir;
}

/**
 * 沙箱只读映射宿主 Python 安装树（Windows MXC 必需；Linux bwrap 同样需要能读到解释器与标准库）。
 */
export function resolvePythonReadonlyRoots(pythonExecutable: string): string[] {
  const roots = new Set<string>();
  const prefix = pythonPrefixOf(pythonExecutable);
  if (!prefix) return [];
  roots.add(prefix);
  for (const sub of ['DLLs', 'Lib', 'lib', 'libs', 'include', 'bin', 'Scripts']) {
    const p = join(prefix, sub);
    if (existsSync(p)) roots.add(p);
  }
  return [...roots];
}

/** Windows：`_ssl` / `_ctypes` 依赖 System32。Linux 返回空。 */
export function resolveSystemReadonlyRoots(platform: NodeJS.Platform = process.platform): string[] {
  if (platform !== 'win32') return [];
  const sys = process.env.SystemRoot || 'C:\\Windows';
  const out: string[] = [];
  for (const leaf of ['System32', 'SysWOW64']) {
    const p = join(sys, leaf);
    if (existsSync(p)) out.push(p);
  }
  return out;
}

/**
 * 把宿主 Python 的 DLLs/*.dll|*.pyd 镜像进 venv（仅 Windows 有意义）。
 */
export function mirrorPythonDllsIntoVenv(pythonExecutable: string, venvRoot: string): number {
  const prefix = pythonPrefixOf(pythonExecutable);
  if (!prefix) return 0;
  const src = join(prefix, 'DLLs');
  if (!existsSync(src)) return 0;
  const dests = [join(venvRoot, 'DLLs'), join(venvRoot, 'Scripts')];
  for (const d of dests) mkdirSync(d, { recursive: true });
  let n = 0;
  for (const name of readdirSync(src)) {
    if (!/\.(dll|pyd)$/i.test(name)) continue;
    const from = join(src, name);
    for (const d of dests) {
      copyFileSync(from, join(d, name));
      n++;
    }
  }
  return n;
}

/** venv 内解释器路径（Windows Scripts/python.exe，Linux bin/python）。 */
export function venvPythonPath(venvRoot: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32'
    ? join(venvRoot, 'Scripts', 'python.exe')
    : join(venvRoot, 'bin', 'python');
}

export function venvPipPath(venvRoot: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32'
    ? join(venvRoot, 'Scripts', 'pip.exe')
    : join(venvRoot, 'bin', 'pip');
}

/** site-packages：Windows `Lib/site-packages`；Linux `lib/python3.x/site-packages`。 */
export function venvSitePackagesDir(venvRoot: string, platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform === 'win32') {
    const p = join(venvRoot, 'Lib', 'site-packages');
    return existsSync(p) ? p : p;
  }
  const lib = join(venvRoot, 'lib');
  if (!existsSync(lib)) return undefined;
  for (const name of readdirSync(lib)) {
    if (!/^python3(\.\d+)?$/.test(name)) continue;
    const site = join(lib, name, 'site-packages');
    if (existsSync(site)) return site;
  }
  // 尚未创建完时按常见布局猜测
  const guessed = readdirSync(lib).find((n) => n.startsWith('python'));
  return guessed ? join(lib, guessed, 'site-packages') : undefined;
}

/** 把 Windows NTSTATUS 风格的负数 exitCode 译成可读说明。 */
export function describeWindowsExitCode(exitCode: number): string | undefined {
  const u = exitCode < 0 ? exitCode + 0x1_0000_0000 : exitCode;
  const known: Record<number, string> = {
    0xc0000135: 'STATUS_DLL_NOT_FOUND — usually the sandbox cannot read the host Python install (map it as readonlyPaths)',
    0xc0000005: 'STATUS_ACCESS_VIOLATION',
    0xc0000142: 'STATUS_DLL_INIT_FAILED',
    0xc000007b: 'STATUS_INVALID_IMAGE_FORMAT',
  };
  const msg = known[u];
  if (!msg) return undefined;
  return `0x${u.toString(16).toUpperCase()}: ${msg}`;
}
