import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

/**
 * 在宿主上解析 Python 可执行文件的绝对路径（不进沙箱）。
 * 配置为空或相对名时用 `where.exe`。
 */
export function resolveHostPythonExecutable(configured: string): string {
  const trimmed = configured.trim();
  if (trimmed && (isAbsolute(trimmed) || existsSync(trimmed))) {
    return resolve(trimmed);
  }
  const name = trimmed || 'python';
  try {
    const out = execFileSync('where.exe', [name], { encoding: 'utf8', windowsHide: true });
    const first = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => s && existsSync(s));
    if (first) return resolve(first);
  } catch {
    /* fall through */
  }
  return name;
}

export function pythonPrefixOf(pythonExecutable: string): string | undefined {
  if (!pythonExecutable || !existsSync(pythonExecutable)) return undefined;
  let dir = dirname(resolve(pythonExecutable));
  if (basename(dir).toLowerCase() === 'scripts') dir = dirname(dir);
  return dir;
}

/**
 * MXC 需要把宿主 Python 安装树标为只读，否则进程会以 STATUS_DLL_NOT_FOUND
 * （exit -1073741515 / 0xC0000135）秒退：沙箱默认看不到 C:\Python3xx。
 */
export function resolvePythonReadonlyRoots(pythonExecutable: string): string[] {
  const roots = new Set<string>();
  const prefix = pythonPrefixOf(pythonExecutable);
  if (!prefix) return [];
  roots.add(prefix);
  for (const sub of ['DLLs', 'Lib', 'libs', 'include']) {
    const p = join(prefix, sub);
    if (existsSync(p)) roots.add(p);
  }
  return [...roots];
}

/** `_ssl` / `_ctypes` 还依赖 System32 里的系统 DLL；尽量只读映射进去。 */
export function resolveSystemReadonlyRoots(): string[] {
  const sys = process.env.SystemRoot || 'C:\\Windows';
  const out: string[] = [];
  for (const leaf of ['System32', 'SysWOW64']) {
    const p = join(sys, leaf);
    if (existsSync(p)) out.push(p);
  }
  return out;
}

/**
 * 把宿主 Python 的 DLLs/*.dll|*.pyd 镜像进 venv，便于沙箱侧按工作目录加载
 * （不能替代 System32，但对 libssl/libffi 等同目录依赖有帮助）。
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
