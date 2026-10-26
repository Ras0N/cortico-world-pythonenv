import { writeDebug, writeDebugOutputFiles } from '../debug-log.ts';
import { resolveSystemReadonlyRoots } from '../python-home.ts';
import type { CommandRunner, RunRequest, RunResult } from './types.ts';

/**
 * Windows MXC process containment runner.
 * 依赖 @microsoft/mxc-sdk（MIT，Microsoft）。
 *
 * `_ssl` / `_ctypes` 需要 System32 与 internetClient 等能力；仅映射 Python 树不够。
 */
export class MxcCommandRunner implements CommandRunner {
  async run(req: RunRequest): Promise<RunResult> {
    const dbg = (level: 'info' | 'warn' | 'error', msg: string, data?: unknown) =>
      writeDebug(req.workDirAbs, level, `mxc: ${msg}`, data);

    if (process.platform !== 'win32') {
      throw new Error('cortico-world-pythonenv MXC runner supports Windows only in this version.');
    }
    if (req.containment === 'windows_sandbox') {
      throw new Error('containment "windows_sandbox" is not implemented in this version; use "process".');
    }

    dbg('info', 'import sdk');
    const mxc = await import('@microsoft/mxc-sdk/v1');
    const support = mxc.getPlatformSupport();
    dbg('info', 'platform support', {
      isSupported: support.isSupported,
      unavailableReasons: support.unavailableReasons,
    });
    if (!support.isSupported) {
      const reasons = support.unavailableReasons
        ? Object.entries(support.unavailableReasons)
            .map(([k, v]) => `${k}: ${v}`)
            .join('; ')
        : 'unknown reason';
      dbg('error', 'not available', { reasons });
      throw new Error(`MXC is not available on this host (${reasons})`);
    }

    const readonlyPaths = unique([...(req.readonlyPaths ?? []), ...resolveSystemReadonlyRoots()]);
    const readwritePaths = [req.workDirAbs];
    try {
      const tmpPolicy = mxc.policy.filesystem.getTemporaryFilesPolicy();
      for (const p of tmpPolicy.readwritePaths ?? []) {
        if (p) readwritePaths.push(p);
      }
    } catch {
      /* optional */
    }

    dbg('info', 'run', {
      command: req.command,
      cwd: req.cwd,
      timeoutMs: req.timeoutMs,
      readwritePaths,
      readonlyPaths,
    });
    try {
      const result = await mxc.run({
        command: req.command,
        workingDirectory: req.cwd,
        timeoutMs: req.timeoutMs,
        // 具体 backend，以便带上 AppContainer capabilities（_ssl / 证书）
        containment: {
          type: 'processcontainer',
          config: {
            capabilities: ['internetClient', 'sharedUserCertificates'],
          },
        },
        filesystem: {
          readwritePaths,
          readonlyPaths: readonlyPaths.length ? readonlyPaths : undefined,
        },
        network: {
          egress: { default: 'allow' },
          ingress: { default: 'deny', hostLoopback: 'deny' },
        },
        ui: { disable: true },
        environment: req.env,
        inheritDefaultEnvironment: true,
      });
      writeDebugOutputFiles(req.workDirAbs, 'mxc', {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
      });
      dbg('info', 'run finished', {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        warnings: result.warnings,
        stdoutLen: (result.stdout ?? '').length,
        stderrLen: (result.stderr ?? '').length,
        stderrHead: (result.stderr ?? '').slice(0, 500),
      });
      return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      };
    } catch (e) {
      dbg('error', 'run threw', {
        err: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
        name: e instanceof Error ? e.name : undefined,
      });
      throw e;
    }
  }
}

function unique(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const key = p.replace(/[\\/]+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
