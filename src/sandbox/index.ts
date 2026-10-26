import { BwrapCommandRunner } from './bwrap.ts';
import { MxcCommandRunner } from './mxc.ts';
import type { CommandRunner } from './types.ts';

/** 按宿主 OS 选择平台沙箱实现。 */
export function createSandboxRunner(platform: NodeJS.Platform = process.platform): CommandRunner {
  if (platform === 'win32') return new MxcCommandRunner();
  if (platform === 'linux') return new BwrapCommandRunner();
  throw new Error(
    `cortico-world-pythonenv supports Windows (MXC) and Linux (bubblewrap) only; got platform=${platform}`,
  );
}

export function isPlatformSandboxRunner(runner: CommandRunner): boolean {
  return runner instanceof MxcCommandRunner || runner instanceof BwrapCommandRunner;
}

export { BwrapCommandRunner } from './bwrap.ts';
export { MxcCommandRunner } from './mxc.ts';
