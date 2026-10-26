/**
 * 受限 shell：只允许白名单命令，禁止管道/重定向/链式与 powershell/cmd。
 * 路径参数必须是相对工作目录的相对路径（由调用方再 resolve）。
 */

export type ShellOk = { ok: true; argv: string[]; display: string };
export type ShellErr = { ok: false; reason: string };
export type ShellParseResult = ShellOk | ShellErr;

const ALLOWED = new Set(['python', 'pip', 'dir', 'ls', 'type', 'cat', 'mkdir', 'pwd']);

/** 引号外若出现这些字符则拒绝（引号内允许 `print(1)` 这类参数）。 */
const META_OUTSIDE_QUOTES = new Set(['|', '&', ';', '<', '>', '`', '\n', '\r']);

/** 简单按空白分词，支持双引号字符串；同时检测引号外元字符。 */
export function tokenize(command: string): { argv: string[] } | { error: string } {
  const out: string[] = [];
  let cur = '';
  let inQuote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      else cur += ch;
      continue;
    }
    if (META_OUTSIDE_QUOTES.has(ch) || ch === '$' || ch === '(' || ch === ')' || ch === '{' || ch === '}' || ch === '!') {
      return { error: 'shell metacharacters (pipes, redirects, chaining, substitutions) are not allowed' };
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (inQuote) return { error: 'unclosed quote' };
  if (cur) out.push(cur);
  return { argv: out };
}

export function parseRestrictedShell(command: string): ShellParseResult {
  const raw = String(command ?? '').trim();
  if (!raw) return { ok: false, reason: 'empty command' };
  const tokenized = tokenize(raw);
  if ('error' in tokenized) return { ok: false, reason: tokenized.error };
  const argv = tokenized.argv;
  if (argv.length === 0) return { ok: false, reason: 'could not parse command' };

  const bin = argv[0].toLowerCase().replace(/\.exe$/i, '');
  // 拒绝路径形式的解释器（如 C:\…\powershell.exe 或 ..\python）
  if (bin.includes('/') || bin.includes('\\') || bin.includes(':')) {
    return { ok: false, reason: 'command binary must be a bare allowlisted name (python, pip, dir, ls, type, cat, mkdir, pwd)' };
  }
  if (bin === 'powershell' || bin === 'pwsh' || bin === 'cmd' || bin === 'command') {
    return { ok: false, reason: `${bin} is not allowed in pe_shell` };
  }
  if (!ALLOWED.has(bin)) {
    return { ok: false, reason: `command not allowlisted: ${argv[0]}` };
  }
  return { ok: true, argv, display: argv.join(' ') };
}

/** 将白名单 argv 映射为在工作目录内实际执行的命令行（Windows）。 */
export function mapShellArgvToCommand(
  argv: string[],
  paths: { pythonExe: string; pipExe: string },
): { ok: true; command: string } | { ok: false; reason: string } {
  const bin = argv[0].toLowerCase().replace(/\.exe$/i, '');
  const rest = argv.slice(1);
  const q = (s: string) => (/\s/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

  switch (bin) {
    case 'python':
      return { ok: true, command: [q(paths.pythonExe), ...rest.map(q)].join(' ') };
    case 'pip':
      return { ok: true, command: [q(paths.pipExe), ...rest.map(q)].join(' ') };
    case 'dir':
    case 'ls':
      return { ok: true, command: ['cmd.exe /d /s /c dir', ...rest.map(q)].join(' ') };
    case 'type':
    case 'cat':
      if (rest.length !== 1) return { ok: false, reason: 'type/cat requires exactly one relative path' };
      return { ok: true, command: `cmd.exe /d /s /c type ${q(rest[0])}` };
    case 'mkdir':
      if (rest.length < 1) return { ok: false, reason: 'mkdir requires a relative path' };
      return { ok: true, command: ['cmd.exe /d /s /c mkdir', ...rest.map(q)].join(' ') };
    case 'pwd':
      return { ok: true, command: 'cmd.exe /d /s /c cd' };
    default:
      return { ok: false, reason: `unmapped command: ${bin}` };
  }
}
