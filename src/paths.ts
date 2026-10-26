import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

export type PathOk = { ok: true; abs: string; rel: string };
export type PathErr = { ok: false; reason: string };
export type PathResult = PathOk | PathErr;

function tryRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    // 目标尚不存在时，realpath 父目录再拼末段。
    const parent = resolve(p, '..');
    try {
      return join(realpathSync(parent), p.slice(parent.length).replace(/^[\\/]/, '') || '');
    } catch {
      return resolve(p);
    }
  }
}

/** 规范化工作目录；必须是已存在的绝对路径目录。 */
export function normalizeWorkDir(workDir: string): PathResult {
  const trimmed = workDir.trim();
  if (!trimmed) return { ok: false, reason: 'workDir is empty; set worlds.pythonenv.workDir to an absolute directory.' };
  if (!isAbsolute(trimmed)) return { ok: false, reason: `workDir must be absolute, got: ${trimmed}` };
  const abs = resolve(trimmed);
  if (!existsSync(abs)) return { ok: false, reason: `workDir does not exist: ${abs}` };
  let st;
  try {
    st = statSync(abs);
  } catch (e) {
    return { ok: false, reason: `workDir is not accessible: ${abs} (${String(e)})` };
  }
  if (!st.isDirectory()) return { ok: false, reason: `workDir is not a directory: ${abs}` };
  const real = tryRealpath(abs);
  return { ok: true, abs: real, rel: '.' };
}

function underRoot(root: string, candidate: string): boolean {
  const a = root.replace(/[\\/]+$/, '').toLowerCase();
  const b = candidate.replace(/[\\/]+$/, '').toLowerCase();
  return b === a || b.startsWith(a + sep.toLowerCase()) || b.startsWith(a + '/');
}

/**
 * 将相对工作目录的路径解析为绝对路径；拒绝绝对路径、越界与盘符逃逸。
 * `allowMissing` 为 true 时允许尚不存在的路径（写文件前）。
 */
export function resolveInWorkDir(workDirAbs: string, userPath: string, opts?: { allowMissing?: boolean }): PathResult {
  const raw = String(userPath ?? '').trim();
  if (!raw || raw === '.') {
    return { ok: true, abs: workDirAbs, rel: '.' };
  }
  if (isAbsolute(raw) || /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
    return { ok: false, reason: 'absolute paths are not allowed; use a path relative to the work directory.' };
  }
  const normalized = normalize(raw);
  const abs = resolve(workDirAbs, normalized);
  const rootReal = tryRealpath(workDirAbs);
  const candidateReal = opts?.allowMissing && !existsSync(abs) ? tryRealpath(abs) : tryRealpath(abs);
  if (!underRoot(rootReal, candidateReal) && !underRoot(workDirAbs, abs)) {
    return { ok: false, reason: `path escapes work directory: ${raw}` };
  }
  // 二次校验：relative 不得以 .. 开头
  const rel = relative(rootReal, candidateReal);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    return { ok: false, reason: `path escapes work directory: ${raw}` };
  }
  return { ok: true, abs: candidateReal, rel: rel || '.' };
}

/** 判断绝对路径是否落在工作目录内（供规则与钩子复用）。 */
export function isInsideWorkDir(workDirAbs: string, absPath: string): boolean {
  const root = tryRealpath(workDirAbs);
  const cand = tryRealpath(absPath);
  return underRoot(root, cand);
}
