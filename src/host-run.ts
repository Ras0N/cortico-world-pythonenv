import { spawn } from 'node:child_process';
import type { RunResult } from './sandbox/types.ts';

/**
 * 在宿主上跑固定引导命令（仅用于创建工作目录内的 venv）。
 * 不经 MXC：AppContainer 下 `_ssl` / `_ctypes` 常因系统 DLL 加载失败。
 */
export function runOnHost(opts: {
  command: string;
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(opts.command, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      shell: true,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs);
    child.stdout?.on('data', (c) => {
      stdout += String(c);
    });
    child.stderr?.on('data', (c) => {
      stderr += String(c);
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: `${stderr}\n${err.message}`, exitCode: 1, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 1, timedOut });
    });
  });
}
