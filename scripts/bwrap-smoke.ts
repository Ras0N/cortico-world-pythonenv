/**
 * Linux VM smoke for bubblewrap runner (slice B).
 *
 *   pnpm smoke:bwrap
 *   # or: pnpm exec tsx scripts/bwrap-smoke.ts
 *
 * Expects Debian/Ubuntu with bubblewrap + python3.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  BWRAP_INSTALL_HINT,
  BwrapCommandRunner,
  resolveBwrapBinary,
} from '../src/sandbox/bwrap.ts';

if (process.platform !== 'linux') {
  console.error(`bwrap-smoke: Linux only (got ${process.platform})`);
  process.exit(2);
}

let work: string | undefined;
try {
  const bin = resolveBwrapBinary();
  console.log('bwrap:', bin);

  // 优先放在 $HOME 下，避免与「把 /tmp 重挂到 venv-state/tmp」打架；runner 已兼容 /tmp 下的 workDir。
  const base = join(homedir(), '.cache');
  mkdirSync(base, { recursive: true });
  work = mkdtempSync(join(base, 'pe-bwrap-smoke-'));
  mkdirSync(join(work, 'venv-state', 'tmp'), { recursive: true });
  writeFileSync(join(work, 'probe.py'), 'import ssl\nprint(ssl.OPENSSL_VERSION)\n');

  const runner = new BwrapCommandRunner();
  const result = await runner.run({
    command: 'python3 probe.py',
    cwd: work,
    workDirAbs: work,
    timeoutMs: 30_000,
    containment: 'bwrap',
    env: {
      PYTHONENV_WORKDIR: work,
      PYTHONENV_NET_BLACKLIST: '',
    },
    readonlyPaths: [],
  });

  console.log(
    JSON.stringify(
      {
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stdout: result.stdout.trim(),
        stderrHead: result.stderr.replace(/\s+/g, ' ').slice(0, 240),
      },
      null,
      2,
    ),
  );

  if (result.exitCode !== 0 || result.timedOut) process.exit(1);
  if (!/OpenSSL/i.test(result.stdout)) {
    console.error('expected OpenSSL version in stdout');
    process.exit(1);
  }
  console.log('ok');
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(msg);
  if (/bubblewrap|bwrap/i.test(msg)) console.error(BWRAP_INSTALL_HINT);
  process.exit(1);
} finally {
  if (work) rmSync(work, { recursive: true, force: true });
}
