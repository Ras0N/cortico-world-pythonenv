/** 规则/特征高危检测：命中则默认拒绝。不上传任何数据。 */

export interface RuleHit {
  id: string;
  message: string;
}

export interface RuleScanInput {
  tool: string;
  text: string;
  workDirAbs?: string;
  networkBlacklist?: string[];
}

const RULES: Array<{ id: string; message: string; re: RegExp }> = [
  {
    id: 'secret.aws_key',
    message: 'possible AWS access key material',
    re: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    id: 'secret.openai_sk',
    message: 'possible OpenAI-style API key',
    re: /\bsk-[A-Za-z0-9_-]{20,}\b/,
  },
  {
    id: 'secret.generic_api_key',
    message: 'possible API key assignment',
    re: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token)\b\s*[=:]\s*['"][^'"]{8,}/i,
  },
  {
    id: 'secret.pem_private',
    message: 'PEM private key material',
    re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    id: 'privacy.userprofile',
    message: 'reference to user profile / AppData outside the work directory',
    re: /%USERPROFILE%|%APPDATA%|%LOCALAPPDATA%|\\Users\\[^\\/]+\\AppData\b/i,
  },
  {
    id: 'privacy.ssh_browser',
    message: 'reference to SSH keys or browser profile paths',
    re: /\.ssh\b|Login Data|Cookies\\[^\\]|\\Google\\Chrome\\|\\Mozilla\\Firefox\\/i,
  },
  {
    id: 'danger.powershell_enc',
    message: 'encoded PowerShell execution',
    re: /powershell(?:\.exe)?\s+.*-(?:enc|encodedcommand)\b/i,
  },
  {
    id: 'danger.certutil_download',
    message: 'certutil download / decode pattern',
    re: /\bcertutil(?:\.exe)?\b.*(-urlcache|-decode)/i,
  },
  {
    id: 'danger.bitsadmin',
    message: 'bitsadmin transfer pattern',
    re: /\bbitsadmin(?:\.exe)?\b/i,
  },
  {
    id: 'danger.shellcode_markers',
    message: 'shellcode / reflective load markers',
    re: /\b(?:VirtualAlloc|WriteProcessMemory|CreateRemoteThread|NtAllocateVirtualMemory)\b|\\x90\\x90\\x90/,
  },
  {
    id: 'escape.system32',
    message: 'access to Windows system directories',
    re: /C:\\Windows\\System32|C:\/Windows\/System32|%SystemRoot%/i,
  },
  {
    id: 'escape.etc',
    message: 'access to Unix system config paths',
    re: /(?:^|[\s'"\\])\/etc\/(?:passwd|shadow|sudoers)/,
  },
];

/** 主机名是否命中黑名单（精确或后缀匹配，如 `.evil.com`）。 */
export function hostMatchesBlacklist(host: string, blacklist: string[]): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  if (!h) return false;
  for (const raw of blacklist) {
    const entry = raw.trim().toLowerCase().replace(/^\*\./, '.');
    if (!entry) continue;
    if (entry.startsWith('.')) {
      if (h === entry.slice(1) || h.endsWith(entry)) return true;
    } else if (h === entry || h.endsWith('.' + entry)) {
      return true;
    }
  }
  return false;
}

const URL_HOST_RE = /(?:https?|ftp):\/\/([^/\s:'"]+)/gi;
const BARE_HOST_RE = /\b(?:host\s*=\s*|connect\s*\(\s*['"])([A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi;

export function scanForHighRisk(input: RuleScanInput): RuleHit | null {
  const text = input.text;
  if (!text) return null;

  for (const rule of RULES) {
    if (rule.re.test(text)) {
      return { id: rule.id, message: rule.message };
    }
  }

  const blacklist = input.networkBlacklist ?? [];
  if (blacklist.length > 0) {
    for (const re of [URL_HOST_RE, BARE_HOST_RE]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const host = m[1].split(':')[0];
        if (hostMatchesBlacklist(host, blacklist)) {
          return {
            id: 'network.blacklist',
            message: `host is on the network blacklist: ${host}`,
          };
        }
      }
    }
  }

  return null;
}

/** 脱敏：缩短疑似密钥片段，避免回执与审计原文回显。 */
export function redactSecrets(text: string): string {
  return text
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA***')
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, 'sk-***')
    .replace(/(-----BEGIN [^-]*PRIVATE KEY-----)[\s\S]*?(-----END [^-]*PRIVATE KEY-----)/g, '$1***$2');
}
