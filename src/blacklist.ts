import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** 包内默认模板；部署覆盖写在 botDir/worlds/pythonenv/NETWORK_BLACKLIST.md。 */
export const NETWORK_BLACKLIST_BASENAME = 'NETWORK_BLACKLIST.md';

export function networkBlacklistOverridePath(botDir: string): string {
  return join(botDir, 'worlds', 'pythonenv', NETWORK_BLACKLIST_BASENAME);
}

/** 有部署覆盖则读覆盖，否则读包内默认。 */
export function resolveNetworkBlacklistPaths(
  botDir: string,
  packageDefaultPath: string,
): { readPath: string; writePath: string } {
  const writePath = networkBlacklistOverridePath(botDir);
  return {
    readPath: existsSync(writePath) ? writePath : packageDefaultPath,
    writePath,
  };
}

/**
 * 解析黑名单正文：去掉 `#` 注释行，再按逗号/分号/换行拆分。
 * 兼容旧配置里的单行逗号分隔字符串。
 */
export function parseBlacklist(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  if (!raw) return [];
  const withoutComments = String(raw)
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return '';
      const hash = trimmed.indexOf(' #');
      return hash >= 0 ? trimmed.slice(0, hash).trim() : trimmed;
    })
    .join('\n');
  return withoutComments
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function readNetworkBlacklist(botDir: string, packageDefaultPath: string): string[] {
  const { readPath } = resolveNetworkBlacklistPaths(botDir, packageDefaultPath);
  if (!existsSync(readPath)) return [];
  return parseBlacklist(readFileSync(readPath, 'utf8'));
}

/** 把旧 config.networkBlacklist 迁到部署覆盖（仅当覆盖尚不存在且旧值非空）。 */
export function migrateLegacyNetworkBlacklist(
  botDir: string,
  legacy: string | undefined,
): boolean {
  const text = typeof legacy === 'string' ? legacy.trim() : '';
  if (!text) return false;
  const override = networkBlacklistOverridePath(botDir);
  if (existsSync(override)) return false;
  mkdirSync(dirname(override), { recursive: true });
  const entries = parseBlacklist(text);
  const body =
    `# Migrated from worlds.pythonenv.networkBlacklist\n` +
    entries.map((e) => e).join('\n') +
    (entries.length ? '\n' : '');
  writeFileSync(override, body, 'utf8');
  return true;
}

/** 给环境提示词用的短摘要。 */
export function summarizeBlacklist(entries: string[], max = 8): string {
  if (!entries.length) return '(empty)';
  if (entries.length <= max) return entries.join(', ');
  return `${entries.slice(0, max).join(', ')} …(+${entries.length - max})`;
}
