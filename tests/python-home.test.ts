import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  describeWindowsExitCode,
  injectPythonenvHooks,
  resolvePythonReadonlyRoots,
  venvPipPath,
  venvPythonPath,
} from '../src/python-home.ts';

const HOOKS_SRC = join(dirname(fileURLToPath(import.meta.url)), '../src/assets/sitecustomize.py');

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

  it('injects pythonenv_hooks module + pth (+ sitecustomize copy)', () => {
    const site = join(root, 'site-packages');
    injectPythonenvHooks(site, HOOKS_SRC);
    expect(existsSync(join(site, 'pythonenv_hooks.py'))).toBe(true);
    expect(existsSync(join(site, 'sitecustomize.py'))).toBe(true);
    expect(readFileSync(join(site, 'pythonenv_hooks.pth'), 'utf8')).toBe('import pythonenv_hooks\n');
  });
});
