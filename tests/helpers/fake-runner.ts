import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { VENV_DIR } from '../../src/layout.ts';
import type { CommandRunner, RunRequest, RunResult } from '../../src/sandbox/types.ts';

/** 测试用：不调 MXC；模拟 venv 创建与 ensurepip，其它命令返回固定输出。 */
export class FakeRunner implements CommandRunner {
  commands: string[] = [];

  async run(req: RunRequest): Promise<RunResult> {
    this.commands.push(req.command);
    if (req.command.includes('-m venv')) {
      const scripts = join(req.workDirAbs, VENV_DIR, 'Scripts');
      const site = join(req.workDirAbs, VENV_DIR, 'Lib', 'site-packages');
      mkdirSync(scripts, { recursive: true });
      mkdirSync(site, { recursive: true });
      if (!existsSync(join(scripts, 'python.exe'))) writeFileSync(join(scripts, 'python.exe'), '');
      // --without-pip：此处还不写 pip.exe
      return { stdout: 'venv ok', stderr: '', exitCode: 0, timedOut: false };
    }
    if (req.command.includes('ensurepip')) {
      const scripts = join(req.workDirAbs, VENV_DIR, 'Scripts');
      mkdirSync(scripts, { recursive: true });
      if (!existsSync(join(scripts, 'pip.exe'))) writeFileSync(join(scripts, 'pip.exe'), '');
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
