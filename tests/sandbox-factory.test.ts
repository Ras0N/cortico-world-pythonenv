import { describe, it, expect } from 'vitest';
import { createSandboxRunner, isPlatformSandboxRunner, BwrapCommandRunner, MxcCommandRunner } from '../src/sandbox/index.ts';
import { FakeRunner } from './helpers/fake-runner.ts';

describe('createSandboxRunner', () => {
  it('picks MXC on win32 and bwrap on linux', () => {
    expect(createSandboxRunner('win32')).toBeInstanceOf(MxcCommandRunner);
    expect(createSandboxRunner('linux')).toBeInstanceOf(BwrapCommandRunner);
  });

  it('rejects unsupported platforms', () => {
    expect(() => createSandboxRunner('darwin')).toThrow(/Windows \(MXC\) and Linux/);
  });

  it('detects platform runners vs fake', () => {
    expect(isPlatformSandboxRunner(new MxcCommandRunner())).toBe(true);
    expect(isPlatformSandboxRunner(new BwrapCommandRunner())).toBe(true);
    expect(isPlatformSandboxRunner(new FakeRunner())).toBe(false);
  });
});
