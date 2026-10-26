import { describe, it, expect } from 'vitest';
import { mapShellArgvToCommand } from '../src/shell.ts';

const paths = { pythonExe: '/work/venv/bin/python', pipExe: '/work/venv/bin/pip' };

describe('mapShellArgvToCommand', () => {
  it('maps posix builtins without cmd.exe', () => {
    expect(mapShellArgvToCommand(['ls', '-la'], paths, 'linux')).toEqual({
      ok: true,
      command: 'ls -la',
    });
    expect(mapShellArgvToCommand(['cat', 'a.txt'], paths, 'linux')).toEqual({
      ok: true,
      command: 'cat a.txt',
    });
    expect(mapShellArgvToCommand(['pwd'], paths, 'linux')).toEqual({ ok: true, command: 'pwd' });
    expect(mapShellArgvToCommand(['dir'], paths, 'linux').ok).toBe(true);
  });

  it('keeps Windows cmd.exe mapping', () => {
    const win = { pythonExe: 'C:\\v\\Scripts\\python.exe', pipExe: 'C:\\v\\Scripts\\pip.exe' };
    const out = mapShellArgvToCommand(['dir'], win, 'win32');
    expect(out.ok && out.command).toMatch(/cmd\.exe/);
  });
});
