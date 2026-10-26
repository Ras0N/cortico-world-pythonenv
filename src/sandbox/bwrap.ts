import { writeDebug } from '../debug-log.ts';
import type { CommandRunner, RunRequest, RunResult } from './types.ts';

/**
 * Linux bubblewrap runner（切片 B 实现执行逻辑）。
 * 切片 A 只提供骨架：缺实现时硬失败，避免静默落到宿主。
 */
export class BwrapCommandRunner implements CommandRunner {
  async run(req: RunRequest): Promise<RunResult> {
    writeDebug(req.workDirAbs, 'error', 'bwrap: not implemented yet (slice B)');
    throw new Error(
      'Linux bubblewrap sandbox is not implemented yet. ' +
        'Install bubblewrap (`sudo apt install bubblewrap`) will be required once slice B lands; ' +
        'until then use pythonExecution=host only for explicit testing, or run on Windows/MXC.',
    );
  }
}
