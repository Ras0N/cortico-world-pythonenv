import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BWRAP_DNS_ROOTS,
  BWRAP_INSTALL_HINT,
  GAI_CONF_PREFER_IPV4,
  buildBwrapArgv,
  resolveBwrapBinary,
} from '../src/sandbox/bwrap.ts';

describe('bwrap argv', () => {
  let work: string;
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'pe-bwrap-'));
    mkdirSync(join(work, 'venv-state', 'tmp'), { recursive: true });
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  it('includes isolation flags, workDir bind, no unshare-net, and sh -c', () => {
    const argv = buildBwrapArgv({
      workDirAbs: work,
      cwd: work,
      command: 'python3 -c "print(1)"',
      env: { PYTHONENV_WORKDIR: work },
      readonlyPaths: ['/usr/local'],
      systemRoots: ['/usr', '/no-such-root-xyz'],
    });
    expect(argv).toContain('--die-with-parent');
    expect(argv).toContain('--new-session');
    expect(argv).toContain('--unshare-pid');
    expect(argv).toContain('--unshare-uts');
    expect(argv).toContain('--unshare-ipc');
    expect(argv).not.toContain('--unshare-net');
    expect(argv).toContain('--hostname');
    expect(argv[argv.indexOf('--hostname') + 1]).toBe('pythonenv');
    expect(argv).toContain('--clearenv');
    expect(argv).toContain('--bind');
    expect(argv).toContain(work);
    expect(argv).toContain('--ro-bind-try');
    expect(argv.slice(-4)).toEqual(['--', '/bin/sh', '-c', 'python3 -c "print(1)"']);
    expect(argv).toContain('PYTHONENV_WORKDIR');
    const chdirIdx = argv.indexOf('--chdir');
    expect(chdirIdx).toBeGreaterThan(-1);
    expect(argv[chdirIdx + 1]).toBe(work);
    for (const dns of BWRAP_DNS_ROOTS) {
      expect(argv).toContain(dns);
    }
    expect(argv).toContain('/etc/gai.conf');
    expect(GAI_CONF_PREFER_IPV4).toMatch(/precedence :ffff:0:0\/96/);
  });

  it('clamps --chdir to workDir when cwd escapes', () => {
    const argv = buildBwrapArgv({
      workDirAbs: work,
      cwd: '/etc',
      command: 'true',
      systemRoots: [],
    });
    expect(argv[argv.indexOf('--chdir') + 1]).toBe(work.replace(/\/+$/, '') || work);
  });

  it('skips readonlyPaths that sit inside workDir', () => {
    const argv = buildBwrapArgv({
      workDirAbs: work,
      cwd: work,
      command: 'true',
      readonlyPaths: [work, join(work, 'venv'), '/opt/py'],
      systemRoots: [],
    });
    const binds: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--ro-bind-try') binds.push(argv[i + 1]!);
    }
    expect(binds).toContain('/opt/py');
    expect(binds).not.toContain(work);
    expect(binds).not.toContain(join(work, 'venv'));
  });

  it('does not remount /tmp over a workDir that already lives under /tmp', () => {
    // mkdtemp 默认在 os.tmpdir()=/tmp/...；若再 --bind xxx /tmp 会盖住 workDir
    const argv = buildBwrapArgv({
      workDirAbs: work,
      cwd: work,
      command: 'true',
      systemRoots: [],
    });
    const tmpBinds: Array<{ src: string; dest: string }> = [];
    for (let i = 0; i < argv.length - 2; i++) {
      if (argv[i] === '--bind' && argv[i + 2] === '/tmp') {
        tmpBinds.push({ src: argv[i + 1]!, dest: argv[i + 2]! });
      }
    }
    if (work.replace(/\\/g, '/').startsWith('/tmp/') || work.replace(/\\/g, '/') === '/tmp') {
      expect(tmpBinds).toEqual([]);
      const tmpdirIdx = argv.indexOf('TMPDIR');
      expect(tmpdirIdx).toBeGreaterThan(-1);
      expect(argv[tmpdirIdx + 1]).toMatch(/venv-state[/\\]tmp/);
    }
  });

  it('remounts /tmp when workDir is outside /tmp', () => {
    // os.tmpdir() 常为 /tmp；在 home 下建真实目录，覆盖「workDir 不在 /tmp」分支（也会写 gai.conf）
    const outside = mkdtempSync(join(homedir(), 'pe-bwrap-out-'));
    try {
      mkdirSync(join(outside, 'venv-state', 'tmp'), { recursive: true });
      const tmpHost = join(outside, 'venv-state', 'tmp');
      const argv = buildBwrapArgv({
        workDirAbs: outside,
        cwd: outside,
        command: 'true',
        systemRoots: [],
      });
      let saw = false;
      for (let i = 0; i < argv.length - 2; i++) {
        if (argv[i] === '--bind' && argv[i + 2] === '/tmp') {
          expect(argv[i + 1]).toBe(tmpHost);
          saw = true;
        }
      }
      expect(saw).toBe(true);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('resolveBwrapBinary', () => {
  it('rejects non-linux', () => {
    expect(() => resolveBwrapBinary('win32')).toThrow(/Linux only/);
  });

  it('install hint mentions apt install bubblewrap', () => {
    expect(BWRAP_INSTALL_HINT).toMatch(/apt install bubblewrap/);
    expect(BWRAP_INSTALL_HINT).toMatch(/Ubuntu 22\.04/);
  });
});
