import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { VENV_DIR } from '../../src/layout.ts';
import { venvPipPath, venvPythonPath } from '../../src/python-home.ts';
import type { CommandRunner, RunRequest, RunResult } from '../../src/sandbox/types.ts';

function fakeSitePackages(venvRoot: string): string {
  return process.platform === 'win32'
    ? join(venvRoot, 'Lib', 'site-packages')
    : join(venvRoot, 'lib', 'python3.11', 'site-packages');
}

/** 测试用：不调 MXC/bwrap；模拟 venv 创建与 ensurepip，其它命令返回固定输出。 */
export class FakeRunner implements CommandRunner {
  commands: string[] = [];

  async run(req: RunRequest): Promise<RunResult> {
    this.commands.push(req.command);
    if (req.command.includes('-m venv')) {
      const root = join(req.workDirAbs, VENV_DIR);
      const py = venvPythonPath(root);
      mkdirSync(dirname(py), { recursive: true });
      mkdirSync(fakeSitePackages(root), { recursive: true });
      if (!existsSync(py)) writeFileSync(py, '');
      return { stdout: 'venv ok', stderr: '', exitCode: 0, timedOut: false };
    }
    if (req.command.includes('ensurepip')) {
      const root = join(req.workDirAbs, VENV_DIR);
      const pip = venvPipPath(root);
      mkdirSync(dirname(pip), { recursive: true });
      if (!existsSync(pip)) writeFileSync(pip, '');
      return { stdout: 'pip ok', stderr: '', exitCode: 0, timedOut: false };
    }
    return {
      stdout: `fake:${req.command}`,
      stderr: '',
      exitCode: 0,
      timedOut: false,
    };
  }
}
