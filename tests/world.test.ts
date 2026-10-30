import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolCallContext } from 'cortico/core/types.ts';
import { dryMountWorld, fakeWorldContext } from 'cortico/extensions/dry-mount.ts';
import { PYTHONENV } from '../src/definition.ts';
import { venvSitePackagesDir } from '../src/python-home.ts';
import { PythonEnvWorld } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';
import { FakeRunner } from './helpers/fake-runner.ts';

let scratchDir: string;
beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), 'pythonenv-world-'));
});
afterEach(() => rmSync(scratchDir, { recursive: true, force: true }));

const call = {} as ToolCallContext;

async function startedWorld() {
  const ctx = fakeWorldContext(PYTHONENV, { scratchDir });
  ctx.persist({ workDir: scratchDir, auditToEvents: true });
  const runner = new FakeRunner();
  const world = new PythonEnvWorld({
    cfg: ctx.cfg,
    timezone: 'UTC',
    botDir: ctx.botDir,
    runner,
  });
  const host = new FakeHost();
  await world.start(host);
  return { world, host, runner, ctx };
}

describe('Python Env World', () => {
  it('默认 hardenUi=false；提示词页含环境提示词与网络黑名单', async () => {
    expect(PYTHONENV.defaults().hardenUi).toBe(false);
    expect(PYTHONENV.defaults().networkBlacklist).toBeUndefined();
    expect(['mxc', 'bwrap']).toContain(PYTHONENV.defaults().pythonExecution);
    const { world } = await startedWorld();
    const vars = world.envPromptVars();
    expect(vars?.['pythonenv.hardenUi']).toBe('false');
    expect(['mxc', 'bwrap', 'host']).toContain(vars?.['pythonenv.pythonExecution']);
    expect(['mxc', 'bwrap', 'host']).toContain(vars?.['pythonenv.sandboxBackend']);
    const docs = world.webUi().promptDocs ?? [];
    expect(docs.map((d) => d.key)).toEqual([
      'worlds.pythonenv.envPrompt',
      'worlds.pythonenv.networkBlacklist',
    ]);
    expect(docs[0]?.role).toBe('envPrompt');
    expect(docs[1]?.role).toBeUndefined();
    expect(docs[1]?.deploymentPath).toBeTruthy();
  });

  it('干装载不报失败', async () => {
    const report = await dryMountWorld(PYTHONENV, { scratchDir });
    expect(report.failures).toEqual([]);
  });

  it('无 workDir 时 start 失败并推送 pythonenv.error', async () => {
    const world = PYTHONENV.create(fakeWorldContext(PYTHONENV, { scratchDir }));
    const host = new FakeHost();
    await expect(world.start(host)).rejects.toThrow(/workDir/);
    expect(host.events.map((e) => e.type)).toContain('pythonenv.error');
  });

  it('挂载成功推送 pythonenv.ready 并注入 hooks', async () => {
    const { world, host } = await startedWorld();
    expect(host.events.map((e) => e.type)).toEqual(['pythonenv.ready']);
    const site = venvSitePackagesDir(join(scratchDir, 'venv'));
    expect(site).toBeTruthy();
    expect(existsSync(join(site!, 'pythonenv_hooks.py'))).toBe(true);
    expect(existsSync(join(site!, 'pythonenv_hooks.pth'))).toBe(true);
    expect(existsSync(join(site!, 'sitecustomize.py'))).toBe(true);
    await world.stop();
  });

  it('pe_write / pe_read / pe_list 在工作目录内工作', async () => {
    const { world } = await startedWorld();
    const tools = Object.fromEntries(world.tools().map((t) => [t.name, t]));
    expect(await tools.pe_write.handler({ path: 'hello.txt', content: 'hi' }, call)).toMatch(/wrote/);
    expect(await tools.pe_read.handler({ path: 'hello.txt' }, call)).toBe('hi');
    expect(await tools.pe_list.handler({ path: '.' }, call)).toMatch(/hello\.txt/);
  });

  it('路径越界拒绝', async () => {
    const { world, host } = await startedWorld();
    const tools = Object.fromEntries(world.tools().map((t) => [t.name, t]));
    const out = String(await tools.pe_read.handler({ path: '../outside.txt' }, call));
    expect(out).toMatch(/^DENIED/);
    expect(host.events.some((e) => e.type === 'pythonenv.denied')).toBe(true);
  });

  it('高危特征拒绝且审计脱敏', async () => {
    const { world } = await startedWorld();
    const tools = Object.fromEntries(world.tools().map((t) => [t.name, t]));
    const secret = 'sk-abcdefghijklmnopqrstuvwxyz0123456789';
    const out = String(await tools.pe_write.handler({ path: 'x.txt', content: secret }, call));
    expect(out).toMatch(/^DENIED/);
    expect(out).not.toContain(secret);
    const audit = readFileSync(join(scratchDir, 'venv-state', 'audit.jsonl'), 'utf8');
    expect(audit).toMatch(/deny/);
    expect(audit).not.toContain(secret);
  });

  it('pe_shell 拒绝管道与未白名单命令', async () => {
    const { world } = await startedWorld();
    const tools = Object.fromEntries(world.tools().map((t) => [t.name, t]));
    expect(String(await tools.pe_shell.handler({ command: 'dir | more' }, call))).toMatch(/^DENIED/);
    expect(String(await tools.pe_shell.handler({ command: 'curl http://x' }, call))).toMatch(/^DENIED/);
  });

  it('pe_run_python 走 runner', async () => {
    const { world, runner } = await startedWorld();
    writeFileSync(join(scratchDir, 'main.py'), 'print(1)\n');
    const tools = Object.fromEntries(world.tools().map((t) => [t.name, t]));
    const out = String(await tools.pe_run_python.handler({ script: 'main.py' }, call));
    expect(out).toMatch(/exit=0/);
    expect(runner.commands.some((c) => c.includes('main.py'))).toBe(true);
  });

  it('envPromptVars 在未配置 workDir 时为 null', () => {
    const world = PYTHONENV.create(fakeWorldContext(PYTHONENV, { scratchDir }));
    expect(world.envPromptVars()).toBeNull();
  });
});
