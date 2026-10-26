import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  describeWindowsExitCode,
  resolvePythonReadonlyRoots,
  venvPipPath,
  venvPythonPath,
} from '../src/python-home.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pe-pyhome-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('python-home', () => {
  it('maps install prefix and DLLs as readonly roots', () => {
    const prefix = join(root, 'Python315');
    mkdirSync(join(prefix, 'DLLs'), { recursive: true });
    const exe = join(prefix, 'python.exe');
    writeFileSync(exe, '');
    const roots = resolvePythonReadonlyRoots(exe);
    expect(roots).toContain(prefix);
    expect(roots).toContain(join(prefix, 'DLLs'));
  });

  it('decodes STATUS_DLL_NOT_FOUND', () => {
    expect(describeWindowsExitCode(-1073741515)).toMatch(/STATUS_DLL_NOT_FOUND/);
  });

  it('resolves venv python/pip paths per platform', () => {
    const v = join(root, 'venv');
    expect(venvPythonPath(v, 'win32')).toMatch(/Scripts[\\/]python\.exe$/i);
    expect(venvPipPath(v, 'linux')).toMatch(/bin[/\\]pip$/i);
  });
});
