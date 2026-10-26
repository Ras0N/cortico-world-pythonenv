import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  migrateLegacyNetworkBlacklist,
  networkBlacklistOverridePath,
  parseBlacklist,
  readNetworkBlacklist,
  summarizeBlacklist,
} from '../src/blacklist.ts';

let botDir: string;
beforeEach(() => {
  botDir = mkdtempSync(join(tmpdir(), 'pythonenv-bl-'));
});
afterEach(() => rmSync(botDir, { recursive: true, force: true }));

describe('parseBlacklist', () => {
  it('strips # comments and splits lines/commas', () => {
    expect(
      parseBlacklist(`
# header
.evil.com
ok.bad # inline note
a.com, b.com
`),
    ).toEqual(['.evil.com', 'ok.bad', 'a.com', 'b.com']);
  });
});

describe('network blacklist file', () => {
  it('reads package default when no override', () => {
    const pack = join(botDir, 'pack.md');
    writeFileSync(pack, '.from-pack\n');
    expect(readNetworkBlacklist(botDir, pack)).toEqual(['.from-pack']);
  });

  it('prefers deployment override', () => {
    const pack = join(botDir, 'pack.md');
    writeFileSync(pack, '.from-pack\n');
    const override = networkBlacklistOverridePath(botDir);
    mkdirSync(join(botDir, 'worlds', 'pythonenv'), { recursive: true });
    writeFileSync(override, '.from-deploy\n');
    expect(readNetworkBlacklist(botDir, pack)).toEqual(['.from-deploy']);
  });

  it('migrates legacy config once', () => {
    expect(migrateLegacyNetworkBlacklist(botDir, '.legacy.com, other.net')).toBe(true);
    const override = networkBlacklistOverridePath(botDir);
    expect(existsSync(override)).toBe(true);
    expect(parseBlacklist(readFileSync(override, 'utf8'))).toEqual(['.legacy.com', 'other.net']);
    expect(migrateLegacyNetworkBlacklist(botDir, '.ignored')).toBe(false);
  });

  it('summarizes long lists', () => {
    expect(summarizeBlacklist([])).toBe('(empty)');
    expect(summarizeBlacklist(['a', 'b'])).toBe('a, b');
    expect(summarizeBlacklist(['1', '2', '3', '4', '5', '6', '7', '8', '9'], 3)).toBe('1, 2, 3 …(+6)');
  });
});
