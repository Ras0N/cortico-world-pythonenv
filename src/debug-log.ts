import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VENV_STATE_DIR } from './layout.ts';
import { redactSecrets } from './rules.ts';

/**
 * 本机调试日志：`<workDir>/venv-state/debug.log`
 * 长输出另存 `venv-state/last-*.txt`，避免 JSON 行截断。
 */
export function debugLogPath(workDirAbs: string): string {
  return join(workDirAbs, VENV_STATE_DIR, 'debug.log');
}

export function writeDebug(workDirAbs: string, level: 'info' | 'warn' | 'error', msg: string, data?: unknown): void {
  if (!workDirAbs) return;
  try {
    mkdirSync(join(workDirAbs, VENV_STATE_DIR), { recursive: true });
    const payload =
      data === undefined
        ? ''
        : ' ' + redactSecrets(typeof data === 'string' ? data : safeJson(data));
    const line = `${new Date().toISOString()} [${level}] ${redactSecrets(msg)}${payload}\n`;
    appendFileSync(debugLogPath(workDirAbs), line, 'utf8');
  } catch {
    // 调试日志失败不影响主流程
  }
}

/** 把完整 stdout/stderr 落到独立文件（不截断），并在 debug.log 记路径。 */
export function writeDebugOutputFiles(
  workDirAbs: string,
  label: string,
  output: { stdout?: string; stderr?: string },
): { stdoutFile?: string; stderrFile?: string } {
  const dir = join(workDirAbs, VENV_STATE_DIR);
  mkdirSync(dir, { recursive: true });
  const safe = label.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 64);
  const out: { stdoutFile?: string; stderrFile?: string } = {};
  if (output.stdout != null && output.stdout.length > 0) {
    out.stdoutFile = join(dir, `last-${safe}-stdout.txt`);
    writeFileSync(out.stdoutFile, redactSecrets(output.stdout), 'utf8');
  }
  if (output.stderr != null && output.stderr.length > 0) {
    out.stderrFile = join(dir, `last-${safe}-stderr.txt`);
    writeFileSync(out.stderrFile, redactSecrets(output.stderr), 'utf8');
  }
  writeDebug(workDirAbs, 'info', `full command output saved (${label})`, {
    stdoutFile: out.stdoutFile,
    stderrFile: out.stderrFile,
    stdoutLen: output.stdout?.length ?? 0,
    stderrLen: output.stderr?.length ?? 0,
  });
  return out;
}

function safeJson(data: unknown): string {
  try {
    return JSON.stringify(data, (_k, v) => {
      // debug.log 行内摘要；完整内容看 last-*-stderr.txt
      if (typeof v === 'string' && v.length > 1200) return v.slice(0, 1200) + `…(+${v.length - 1200} chars, see venv-state/last-*-stderr.txt)`;
      return v;
    });
  } catch {
    return String(data);
  }
}
