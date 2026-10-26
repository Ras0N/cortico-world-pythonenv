import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeWorkDir, resolveInWorkDir } from '../src/paths.ts';

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pe-paths-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('paths', () => {
  it('normalizeWorkDir rejects empty and relative', () => {
    expect(normalizeWorkDir('').ok).toBe(false);
    expect(normalizeWorkDir('rel').ok).toBe(false);
  });

  it('resolveInWorkDir allows relative files and rejects escape', () => {
    const wd = normalizeWorkDir(root);
    expect(wd.ok).toBe(true);
    if (!wd.ok) return;
    writeFileSync(join(root, 'a.txt'), 'x');
    const ok = resolveInWorkDir(wd.abs, 'a.txt');
    expect(ok.ok).toBe(true);
    expect(resolveInWorkDir(wd.abs, '../a.txt').ok).toBe(false);
    expect(resolveInWorkDir(wd.abs, join(root, 'a.txt')).ok).toBe(false);
  });

  it('resolveInWorkDir allowMissing still rejects drive-absolute', () => {
    const wd = normalizeWorkDir(root);
    expect(wd.ok).toBe(true);
    if (!wd.ok) return;
    mkdirSync(join(root, 'sub'), { recursive: true });
    expect(resolveInWorkDir(wd.abs, 'sub/new.txt', { allowMissing: true }).ok).toBe(true);
    expect(resolveInWorkDir(wd.abs, 'C:\\Windows\\notepad.exe', { allowMissing: true }).ok).toBe(false);
  });
});
