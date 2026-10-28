/**
 * Linux 验收（切片 C 对齐项，供虚拟机跑完剩余检查）。
 *
 *   pnpm smoke:bwrap:accept
 *
 * 覆盖：bwrap 探测、venv 宿主 bootstrap、sitecustomize FS 拦截、黑名单、ssl/HTTPS。
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VENV_DIR, VENV_STATE_DIR } from '../src/layout.ts';
import {
  injectPythonenvHooks,
  resolveHostPythonExecutable,
  resolvePythonReadonlyRoots,
  venvSitePackagesDir,
} from '../src/python-home.ts';
import {
  BWRAP_INSTALL_HINT,
  BwrapCommandRunner,
  resolveBwrapBinary,
} from '../src/sandbox/bwrap.ts';
import type { RunResult } from '../src/sandbox/types.ts';
import { bootstrapVenvOnHost, LINUX_VENV_APT_HINT } from '../src/venv-bootstrap.ts';

if (process.platform !== 'linux') {
  console.error(`bwrap-acceptance: Linux only (got ${process.platform})`);
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));
const SITECUSTOMIZE = join(here, '../src/assets/sitecustomize.py');

function fail(msg: string): never {
  console.error('FAIL:', msg);
  process.exit(1);
}

function ok(step: string): void {
  console.log('ok:', step);
}

let work: string | undefined;
try {
  const bwrapBin = resolveBwrapBinary();
  ok(`bwrap ${bwrapBin}`);

  const base = join(homedir(), '.cache');
  mkdirSync(base, { recursive: true });
  work = mkdtempSync(join(base, 'pe-bwrap-accept-'));
  mkdirSync(join(work, VENV_STATE_DIR, 'tmp'), { recursive: true });

  const hostPy = resolveHostPythonExecutable('python3');
  const timeoutMs = 180_000;
  const envBase = {
    PYTHONENV_WORKDIR: work,
    PYTHONENV_NET_BLACKLIST: '',
    PYTHONENV_READONLY_PREFIXES: [
      ...resolvePythonReadonlyRoots(hostPy),
      '/usr/lib',
      '/lib',
      '/lib64',
      '/etc',
    ].join(','),
    PYTHONNOUSERSITE: '1',
    TEMP: join(work, VENV_STATE_DIR, 'tmp'),
    TMP: join(work, VENV_STATE_DIR, 'tmp'),
    TMPDIR: join(work, VENV_STATE_DIR, 'tmp'),
  };

  let venvPy: string;
  let venvPip: string;
  try {
    const boot = await bootstrapVenvOnHost({
      workDirAbs: work,
      hostPythonAbs: hostPy,
      env: envBase,
      timeoutMs,
    });
    venvPy = boot.venvPython;
    venvPip = boot.venvPip;
    ok(`venv bootstrap on host (pipViaVenvModule=${boot.pipViaVenvModule})`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(msg);
    if (/ensurepip|python3-venv/i.test(msg)) console.error(LINUX_VENV_APT_HINT);
    fail('venv bootstrap');
  }

  const site = venvSitePackagesDir(join(work, VENV_DIR));
  if (!site) fail('site-packages missing');
  injectPythonenvHooks(site, SITECUSTOMIZE);
  ok(`pythonenv hooks injected → ${site}`);

  const runner = new BwrapCommandRunner();
  const readonlyPaths = resolvePythonReadonlyRoots(hostPy);
  const run = (command: string, extraEnv?: Record<string, string>, timeoutMs = 60_000) =>
    runner.run({
      command,
      cwd: work!,
      workDirAbs: work!,
      timeoutMs,
      containment: 'bwrap',
      readonlyPaths,
      env: { ...envBase, PYTHONUNBUFFERED: '1', PYTHONENV_PREFER_IPV4: '1', ...extraEnv },
    });

  const fmt = (r: RunResult) =>
    `exit=${r.exitCode} timedOut=${r.timedOut} stdout=${JSON.stringify(r.stdout)} stderr=${JSON.stringify(r.stderr)}`;

  // Debian/Ubuntu: stdlib sitecustomize (apport) shadows venv sitecustomize.py — we load via .pth
  const hook = await run(
    `${shellQuote(venvPy)} -c "import sys; print('hook', getattr(sys, '_pythonenv_hook', False), 'mod', 'pythonenv_hooks' in sys.modules, flush=True)"`,
  );
  if (hook.exitCode !== 0 || !/hook True/.test(hook.stdout)) {
    fail(`pythonenv hooks not loaded in venv: ${fmt(hook)} (site=${site})`);
  }
  ok('pythonenv hooks loaded in bwrap');

  const ssl = await run(`${shellQuote(venvPy)} -c "import ssl; print(ssl.OPENSSL_VERSION, flush=True)"`);
  if (ssl.exitCode !== 0 || !/OpenSSL/i.test(ssl.stdout)) {
    fail(`ssl: ${fmt(ssl)}`);
  }
  ok(`ssl ${ssl.stdout.trim()}`);

  // 用脚本文件 + 逐步 flush，避免 -c 报错时空输出（块缓冲 / 被杀未刷盘）
  const httpsProbe = join(work, 'https_probe.py');
  writeFileSync(
    httpsProbe,
    [
      'import sys',
      'print("https-probe: start", flush=True)',
      'print("https-probe: prefer_ipv4", __import__("os").environ.get("PYTHONENV_PREFER_IPV4"), flush=True)',
      'try:',
      '  import socket, ssl, urllib.request',
      '  print("https-probe: openssl", ssl.OPENSSL_VERSION, flush=True)',
      '  print("https-probe: ca", ssl.get_default_verify_paths(), flush=True)',
      "  infos = socket.getaddrinfo('pypi.org', 443, type=socket.SOCK_STREAM)",
      '  print("https-probe: addr", [(i[0], i[4][0]) for i in infos[:8]], flush=True)',
      "  url = 'https://pypi.org/simple/'",
      '  resp = urllib.request.urlopen(url, timeout=20)',
      '  print("https-probe: status", resp.status, flush=True)',
      'except Exception as e:',
      '  print("https-probe: ERR", type(e).__name__, e, file=sys.stderr, flush=True)',
      '  raise',
      '',
    ].join('\n'),
  );
  const https = await run(
    `${shellQuote(venvPy)} ${shellQuote(httpsProbe)}`,
    { PYTHONENV_PREFER_IPV4: '1' },
    60_000,
  );
  if (https.exitCode !== 0 || !/https-probe: status 200/.test(https.stdout)) {
    fail(`https: ${fmt(https)}`);
  }
  ok('https pypi.org/simple/');

  // 双保险：sitecustomize → PermissionError；若钩子未拦到，bwrap 对 /etc 只读 → Errno 30
  const outside = await run(
    `${shellQuote(venvPy)} -c "open('/etc/passwd','w').write('x')"`,
  );
  const outsideText = `${outside.stderr}\n${outside.stdout}`;
  const deniedByHook = /pythonenv: refusing path/i.test(outsideText);
  const deniedByRoFs = /Read-only file system|Errno 30/i.test(outsideText);
  if (outside.exitCode === 0 || (!deniedByHook && !deniedByRoFs)) {
    fail(`FS write outside should be denied: ${fmt(outside)}`);
  }
  ok(`FS write outside workdir denied (${deniedByHook ? 'sitecustomize' : 'bwrap-ro'})`);

  const blocked = await run(
    `${shellQuote(venvPy)} -c "import socket; socket.create_connection(('evil.example.com', 443), timeout=2)"`,
    { PYTHONENV_NET_BLACKLIST: '.example.com' },
  );
  if (blocked.exitCode === 0 || !/network blacklist/i.test(blocked.stderr + blocked.stdout)) {
    fail(`blacklist should deny: exit=${blocked.exitCode} out=${blocked.stdout} err=${blocked.stderr}`);
  }
  ok('network blacklist denied');

  const pipList = await run(`${shellQuote(venvPip)} list`);
  if (pipList.exitCode !== 0) fail(`pip list in bwrap: ${pipList.stderr}`);
  ok('pip list inside bwrap');

  // 真装一个小包，覆盖 pe_pip 同路径（bwrap 内 pip + hooks 读 /etc）
  const pipInstall = await run(
    `${shellQuote(venvPip)} install --no-cache-dir --disable-pip-version-check six`,
    undefined,
    180_000,
  );
  if (pipInstall.exitCode !== 0) {
    fail(`pip install six in bwrap: ${fmt(pipInstall)}`);
  }
  const importSix = await run(
    `${shellQuote(venvPy)} -c "import six; print('six', six.__version__, flush=True)"`,
  );
  if (importSix.exitCode !== 0 || !/six /.test(importSix.stdout)) {
    fail(`import six after pip install: ${fmt(importSix)}`);
  }
  ok('pip install six + import inside bwrap');

  console.log('all acceptance checks passed');
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(msg);
  if (/bubblewrap|bwrap/i.test(msg)) console.error(BWRAP_INSTALL_HINT);
  process.exit(1);
} finally {
  if (work) rmSync(work, { recursive: true, force: true });
}

function shellQuote(s: string): string {
  if (!/[^\w@%+=:,./-]/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
