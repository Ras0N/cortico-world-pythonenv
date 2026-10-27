/** Python Env World：工作目录沙箱、文件工具、venv Python/pip、受限 shell、审计与拒绝。 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolDef, World, WorldWebUiDecl, WorldHost } from 'cortico/core/types.ts';
import { nowIso } from 'cortico/core/util.ts';
import { appendAudit } from './audit.ts';
import {
  migrateLegacyNetworkBlacklist,
  readNetworkBlacklist,
  resolveNetworkBlacklistPaths,
  summarizeBlacklist,
} from './blacklist.ts';
import { isSandboxExecution, PYTHONENV_CONFIG_GROUP, type PythonEnvConfigSection } from './config.ts';
import { writeDebug, writeDebugOutputFiles } from './debug-log.ts';
import { runOnHost } from './host-run.ts';
import { VENV_DIR, VENV_STATE_DIR } from './layout.ts';
import { normalizeWorkDir, resolveInWorkDir } from './paths.ts';
import {
  describeWindowsExitCode,
  injectPythonenvHooks,
  resolveHostPythonExecutable,
  resolvePythonReadonlyRoots,
  resolveSystemReadonlyRoots,
  venvPipPath,
  venvPythonPath,
  venvSitePackagesDir,
} from './python-home.ts';
import { redactSecrets, scanForHighRisk } from './rules.ts';
import { resolveBwrapBinary } from './sandbox/bwrap.ts';
import { createSandboxRunner, isPlatformSandboxRunner } from './sandbox/index.ts';
import type { CommandRunner, RunResult } from './sandbox/types.ts';
import { mapShellArgvToCommand, parseRestrictedShell } from './shell.ts';
import { bootstrapVenvOnHost } from './venv-bootstrap.ts';

const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url));
const NETWORK_BLACKLIST_FILE = fileURLToPath(new URL('./NETWORK_BLACKLIST.md', import.meta.url));
const SITECUSTOMIZE_SRC = fileURLToPath(new URL('./assets/sitecustomize.py', import.meta.url));

export interface PythonEnvWorldOptions {
  /** `worlds.pythonenv` 的活引用。 */
  cfg: PythonEnvConfigSection;
  timezone: string;
  /** 部署目录；网络黑名单覆盖写在 `worlds/pythonenv/NETWORK_BLACKLIST.md`。 */
  botDir: string;
  /** 测试可注入；缺省在 start 时按平台 createSandboxRunner()。 */
  runner?: CommandRunner;
}

export const PYTHONENV_TOOL_DECLS: ReadonlyArray<Omit<ToolDef, 'handler'>> = [
  {
    name: 'pe_list',
    description: 'List files and directories under a relative path inside the Python Env work directory.',
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'Relative path inside the work directory (default ".").' },
      },
    },
  },
  {
    name: 'pe_read',
    description: 'Read a text file inside the work directory (size-capped).',
    tags: ['read'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'Relative file path inside the work directory.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'pe_write',
    description: 'Write or overwrite a text file inside the work directory (creates parent dirs).',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'Relative file path inside the work directory.' },
        content: { type: 'string', description: 'File contents to write.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'pe_delete',
    description: 'Delete a file or empty directory inside the work directory.',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', description: 'Relative path inside the work directory.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'pe_run_python',
    description: 'Run a script or -c code with the work directory venv Python (sandboxed).',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        script: { type: 'string', description: 'Relative .py path inside the work directory.' },
        code: { type: 'string', description: 'Python source for python -c (mutually exclusive with script).' },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Extra argv after the script (ignored for -c).',
        },
      },
    },
  },
  {
    name: 'pe_pip',
    description: 'Run pip install/uninstall/list/show against the work directory venv only.',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['install', 'uninstall', 'list', 'show'],
          description: 'pip subcommand.',
        },
        packages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Package names (required for install/uninstall/show).',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'pe_shell',
    description: 'Run one allowlisted command (python, pip, dir/ls, type/cat, mkdir, pwd) inside the sandbox. No pipes or redirects.',
    tags: ['write'],
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        command: { type: 'string', description: 'Single allowlisted command line.' },
      },
      required: ['command'],
    },
  },
];

export class PythonEnvWorld implements World {
  readonly id = 'pythonenv';
  private runner: CommandRunner | undefined;
  private workDirAbs: string | undefined;
  private activeHost: WorldHost | undefined;

  constructor(private readonly opts: PythonEnvWorldOptions) {
    this.runner = opts.runner;
  }

  envPromptVars(): Record<string, string> | null {
    const work = this.opts.cfg.workDir.trim();
    if (!work) return null;
    const bl = this.networkBlacklist();
    const exec = this.opts.cfg.pythonExecution;
    return {
      'pythonenv.workDir': work,
      'pythonenv.blacklistSummary': summarizeBlacklist(bl),
      'pythonenv.pythonExecution': exec,
      'pythonenv.sandboxBackend': this.sandboxBackendLabel(),
      'pythonenv.hardenUi': this.opts.cfg.hardenUi ? 'true' : 'false',
    };
  }

  /** 实际隔离后端（给提示词用）：host / mxc / bwrap。 */
  private sandboxBackendLabel(): string {
    if (!isSandboxExecution(this.opts.cfg.pythonExecution)) return 'host';
    return process.platform === 'linux' ? 'bwrap' : 'mxc';
  }

  tools(): ToolDef[] {
    return PYTHONENV_TOOL_DECLS.map((decl) => ({
      ...decl,
      handler: (args) => this.dispatch(decl.name, args as Record<string, unknown>),
    }));
  }

  webUi(): WorldWebUiDecl {
    return {
      config: [PYTHONENV_CONFIG_GROUP],
      promptDocs: [
        {
          key: 'worlds.pythonenv.envPrompt',
          title: 'Python Env · 环境提示词',
          description: '工作目录沙箱的行为准则与工具用法。',
          path: ENV_PROMPT_FILE,
          role: 'envPrompt',
          vars: [
            { name: 'pythonenv.workDir', description: '当前配置的工作目录。' },
            { name: 'pythonenv.blacklistSummary', description: '网络黑名单摘要（完整名单见同页另一文档）。' },
            { name: 'pythonenv.pythonExecution', description: 'mxc / bwrap / host（配置值）。' },
            {
              name: 'pythonenv.sandboxBackend',
              description: '实际后端：Windows 沙箱=mxc，Linux 沙箱=bwrap，否则 host。',
            },
            {
              name: 'pythonenv.hardenUi',
              description: '仅 Windows：true 时 MXC ui.disable（HTTPS 常不可用）。',
            },
          ],
        },
        (() => {
          const { readPath, writePath } = resolveNetworkBlacklistPaths(
            this.opts.botDir,
            NETWORK_BLACKLIST_FILE,
          );
          return {
            key: 'worlds.pythonenv.networkBlacklist',
            title: 'Python Env · 网络黑名单',
            description:
              '禁止访问的域名或后缀，每行一条（# 注释）。在此编辑长名单比配置项更方便；保存后下次命令生效。',
            path: readPath,
            deploymentPath: writePath,
          };
        })(),
      ],
    };
  }

  async start(host: WorldHost): Promise<void> {
    const wd = normalizeWorkDir(this.opts.cfg.workDir);
    if (!wd.ok) {
      host.log.error('pythonenv start aborted: bad workDir', { reason: wd.reason });
      await this.failStart(host, wd.reason);
      throw new Error(wd.reason);
    }
    this.workDirAbs = wd.abs;
    this.activeHost = host;
    mkdirSync(join(wd.abs, VENV_STATE_DIR, 'tmp'), { recursive: true });
    if (migrateLegacyNetworkBlacklist(this.opts.botDir, this.opts.cfg.networkBlacklist)) {
      writeDebug(wd.abs, 'info', 'migrated legacy networkBlacklist config → NETWORK_BLACKLIST.md');
    }
    const hostPy = resolveHostPythonExecutable(this.hostPython());
    const readonlyPaths = resolvePythonReadonlyRoots(hostPy);
    const blacklist = this.networkBlacklist();
    writeDebug(wd.abs, 'info', 'start begin', {
      workDir: wd.abs,
      containment: this.opts.cfg.containment,
      pythonExecution: this.opts.cfg.pythonExecution,
      sandboxBackend: this.sandboxBackendLabel(),
      hardenUi: this.opts.cfg.hardenUi === true,
      blacklistCount: blacklist.length,
      pythonPath: this.hostPython(),
      hostPythonResolved: hostPy,
      readonlyPaths,
      systemReadonlyPaths: resolveSystemReadonlyRoots(),
      platform: process.platform,
      note:
        'venv bootstrap always on host; runtime: Windows MXC (pip on host) / Linux bwrap (pip in sandbox)',
    });
    if (readonlyPaths.length === 0) {
      writeDebug(wd.abs, 'warn', 'no host Python readonly roots; sandbox may fail to load stdlib', {
        hostPy,
      });
    }

    try {
      // Linux 沙箱模式：尽早探测 bwrap，避免建完 venv 才硬失败
      if (process.platform === 'linux' && isSandboxExecution(this.opts.cfg.pythonExecution)) {
        const bwrapBin = resolveBwrapBinary();
        writeDebug(wd.abs, 'info', 'bwrap available', { bwrapBin });
      }
      // FakeRunner → 模拟路径；生产 → 宿主建 venv（Win 避开 MXC ensurepip/_ssl；Linux 同路径更简单可靠）
      await this.ensureVenv(host);
      if (!this.runner) this.runner = createSandboxRunner();
      this.injectSitecustomize(wd.abs);
      writeDebug(wd.abs, 'info', 'sitecustomize injected', {
        sitePackages: venvSitePackagesDir(this.venvRoot(wd.abs)),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      writeDebug(wd.abs, 'error', 'start failed', {
        err: msg.slice(0, 1500),
        stack: e instanceof Error ? e.stack?.slice(0, 2000) : undefined,
        hint: 'see venv-state/last-*-stderr.txt for full output',
      });
      host.log.error('pythonenv start failed', { err: e });
      await this.failStart(host, msg);
      throw e;
    }

    writeDebug(wd.abs, 'info', 'start ready');
    host.log.info('pythonenv ready', { workDir: wd.abs });
    await host.pushEvent({
      type: 'pythonenv.ready',
      ts: nowIso(this.opts.timezone),
      source: this.id,
      origin: 'internal',
      senderKey: this.id,
      text: `Python Env ready at ${wd.abs}`,
    });
  }

  async stop(): Promise<void> {
    this.workDirAbs = undefined;
    this.activeHost = undefined;
  }

  private async failStart(host: WorldHost, reason: string): Promise<void> {
    await host.pushEvent({
      type: 'pythonenv.error',
      ts: nowIso(this.opts.timezone),
      source: this.id,
      origin: 'internal',
      senderKey: this.id,
      text: `Python Env failed to start: ${redactSecrets(reason)}`,
    });
  }

  private requireWorkDir(): string {
    if (!this.workDirAbs) {
      const wd = normalizeWorkDir(this.opts.cfg.workDir);
      if (!wd.ok) throw new Error(wd.reason);
      this.workDirAbs = wd.abs;
    }
    return this.workDirAbs;
  }

  private venvRoot(workDirAbs: string): string {
    return join(workDirAbs, VENV_DIR);
  }

  private venvPython(workDirAbs: string): string {
    return venvPythonPath(this.venvRoot(workDirAbs));
  }

  private venvPip(workDirAbs: string): string {
    return venvPipPath(this.venvRoot(workDirAbs));
  }

  private sandboxTempDir(workDirAbs: string): string {
    return join(workDirAbs, VENV_STATE_DIR, 'tmp');
  }

  private hostPython(): string {
    const configured = this.opts.cfg.pythonPath.trim();
    if (configured) return configured;
    return process.platform === 'win32' ? 'python' : 'python3';
  }

  /** 宿主 Python 安装树 → MXC readonlyPaths（否则沙箱内 python.exe 会 DLL_NOT_FOUND）。 */
  private hostPythonReadonlyPaths(): string[] {
    return resolvePythonReadonlyRoots(resolveHostPythonExecutable(this.hostPython()));
  }

  private networkBlacklist(): string[] {
    return readNetworkBlacklist(this.opts.botDir, NETWORK_BLACKLIST_FILE);
  }

  private sandboxEnv(workDirAbs: string): Record<string, string> {
    // ensurepip / pip 默认写 TEMP；沙箱往往读不到宿主 Temp → 指到工作目录内。
    const tmp = this.sandboxTempDir(workDirAbs);
    mkdirSync(tmp, { recursive: true });
    const hostPy = resolveHostPythonExecutable(this.hostPython());
    const readonlyPrefixes = uniqueComma([
      ...resolvePythonReadonlyRoots(hostPy),
      ...resolveSystemReadonlyRoots(),
      // Linux：动态库 / CA（sitecustomize 只读放行；写入仍限 workDir）
      ...(process.platform === 'linux'
        ? ['/usr/lib', '/usr/local/lib', '/lib', '/lib64', '/etc/ssl', '/etc/pki']
        : []),
    ]);
    return {
      PYTHONENV_WORKDIR: workDirAbs,
      PYTHONENV_NET_BLACKLIST: this.networkBlacklist().join(','),
      PYTHONENV_READONLY_PREFIXES: readonlyPrefixes,
      // Linux：避免 Hyper-V 等环境 IPv6 黑洞拖死 HTTPS（见 sitecustomize getaddrinfo）
      ...(process.platform === 'linux' ? { PYTHONENV_PREFER_IPV4: '1' } : {}),
      PYTHONNOUSERSITE: '1',
      PIP_DISABLE_PIP_VERSION_CHECK: '1',
      TEMP: tmp,
      TMP: tmp,
      TMPDIR: tmp,
    };
  }

  private injectSitecustomize(workDirAbs: string): void {
    const site = venvSitePackagesDir(this.venvRoot(workDirAbs));
    if (!site || !existsSync(site)) {
      throw new Error(`venv site-packages missing under ${this.venvRoot(workDirAbs)}`);
    }
    injectPythonenvHooks(site, SITECUSTOMIZE_SRC);
  }

  private removeVenvTree(workDirAbs: string): void {
    const root = this.venvRoot(workDirAbs);
    if (existsSync(root)) {
      writeDebug(workDirAbs, 'warn', 'removing incomplete venv', { root });
      rmSync(root, { recursive: true, force: true });
    }
  }

  private venvLooksComplete(workDirAbs: string): boolean {
    return existsSync(this.venvPython(workDirAbs)) && existsSync(this.venvPip(workDirAbs));
  }

  private async ensureVenv(host: WorldHost): Promise<void> {
    // FakeRunner → 模拟；生产一律宿主 bootstrap（见 ensureVenvOnHost 注释）
    if (this.runner && !isPlatformSandboxRunner(this.runner)) {
      await this.ensureVenvWithRunner(host, this.runner);
      return;
    }
    await this.ensureVenvOnHost(host);
  }

  /**
   * 在宿主创建 workDir/venv（切片 C 决策：两平台均宿主 bootstrap）。
   * - Windows：`--without-pip` + ensurepip + DLL 镜像（避开 MXC）。
   * - Linux：`python -m venv` 一次带 pip（需 apt: python3-venv）；运行期再进 bwrap。
   */
  private async ensureVenvOnHost(host: WorldHost): Promise<void> {
    const workDirAbs = this.requireWorkDir();
    const py = this.venvPython(workDirAbs);
    if (this.venvLooksComplete(workDirAbs)) {
      writeDebug(workDirAbs, 'info', 'reuse existing venv', { python: py });
      return;
    }
    if (existsSync(this.venvRoot(workDirAbs))) this.removeVenvTree(workDirAbs);

    const hostPy = resolveHostPythonExecutable(this.hostPython());
    const timeoutMs = Math.max(this.opts.cfg.commandTimeoutMs, 120_000);
    const env = this.sandboxEnv(workDirAbs);
    try {
      const boot = await bootstrapVenvOnHost({
        workDirAbs,
        hostPythonAbs: hostPy,
        env,
        timeoutMs,
        onLog: (msg, data) => writeDebug(workDirAbs, 'info', msg, data),
      });
      writeDebug(workDirAbs, 'info', 'venv bootstrap finished', {
        venvPython: boot.venvPython,
        venvPip: boot.venvPip,
        pipViaVenvModule: boot.pipViaVenvModule,
        platform: process.platform,
      });
    } catch (e) {
      this.removeVenvTree(workDirAbs);
      const msg = e instanceof Error ? e.message : String(e);
      host.log.warn('venv bootstrap failed', { err: msg.slice(0, 1500) });
      throw e;
    }
  }

  private async ensureVenvWithRunner(host: WorldHost, runner: CommandRunner): Promise<void> {
    const workDirAbs = this.requireWorkDir();
    const py = this.venvPython(workDirAbs);
    if (this.venvLooksComplete(workDirAbs)) {
      writeDebug(workDirAbs, 'info', 'reuse existing venv', { python: py });
      return;
    }
    if (existsSync(this.venvRoot(workDirAbs))) this.removeVenvTree(workDirAbs);

    const hostPy = resolveHostPythonExecutable(this.hostPython());
    const readonlyPaths = this.hostPythonReadonlyPaths();
    const timeoutMs = Math.max(this.opts.cfg.commandTimeoutMs, 120_000);
    const run = (command: string) =>
      runner.run({
        command,
        cwd: workDirAbs,
        workDirAbs,
        readonlyPaths,
        timeoutMs,
        containment: this.opts.cfg.containment,
        hardenUi: this.opts.cfg.hardenUi === true,
        env: this.sandboxEnv(workDirAbs),
      });

    const createCmd = `${quoteCmd(hostPy)} -m venv --without-pip ${VENV_DIR}`;
    writeDebug(workDirAbs, 'info', 'creating venv via injected runner', { createCmd });
    let result: RunResult;
    try {
      result = await run(createCmd);
    } catch (e) {
      this.removeVenvTree(workDirAbs);
      throw e;
    }
    if (result.exitCode !== 0 || !existsSync(py)) {
      this.removeVenvTree(workDirAbs);
      throw new Error(`failed to create venv (exit ${result.exitCode}): ${result.stderr}`);
    }
    const pipCmd = `${quoteCmd(py)} -m ensurepip --upgrade --default-pip`;
    result = await run(pipCmd);
    if (result.exitCode !== 0 || !existsSync(this.venvPip(workDirAbs))) {
      this.removeVenvTree(workDirAbs);
      host.log.warn('ensurepip failed', { exitCode: result.exitCode });
      throw new Error(`failed to bootstrap pip (exit ${result.exitCode}): ${result.stderr}`);
    }
  }

  private async dispatch(tool: string, args: Record<string, unknown>): Promise<string> {
    try {
      switch (tool) {
        case 'pe_list':
          return await this.toolList(args);
        case 'pe_read':
          return await this.toolRead(args);
        case 'pe_write':
          return await this.toolWrite(args);
        case 'pe_delete':
          return await this.toolDelete(args);
        case 'pe_run_python':
          return await this.toolRunPython(args);
        case 'pe_pip':
          return await this.toolPip(args);
        case 'pe_shell':
          return await this.toolShell(args);
        default:
          return `unknown tool: ${tool}`;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return this.errorOutcome(tool, msg);
    }
  }

  private async deny(tool: string, summary: string, ruleId: string, detail?: string): Promise<string> {
    const workDirAbs = this.opts.cfg.workDir.trim() ? this.requireWorkDirSafe() : '';
    if (workDirAbs) {
      appendAudit(workDirAbs, {
        ts: new Date().toISOString(),
        tool,
        decision: 'deny',
        summary,
        ruleId,
        detail,
      });
    }
    if (this.opts.cfg.auditToEvents && this.activeHost) {
      await this.activeHost.pushEvent({
        type: 'pythonenv.denied',
        ts: nowIso(this.opts.timezone),
        source: this.id,
        origin: 'internal',
        senderKey: this.id,
        text: redactSecrets(`denied ${tool}: ${summary} [${ruleId}]`),
      });
    }
    return `DENIED [${ruleId}]: ${redactSecrets(summary)}`;
  }

  private requireWorkDirSafe(): string {
    try {
      return this.requireWorkDir();
    } catch {
      const wd = normalizeWorkDir(this.opts.cfg.workDir);
      return wd.ok ? wd.abs : '';
    }
  }

  private allowAudit(tool: string, summary: string): void {
    const workDirAbs = this.requireWorkDirSafe();
    if (!workDirAbs) return;
    appendAudit(workDirAbs, {
      ts: new Date().toISOString(),
      tool,
      decision: 'allow',
      summary,
    });
  }

  private errorOutcome(tool: string, message: string): string {
    const workDirAbs = this.requireWorkDirSafe();
    if (workDirAbs) {
      appendAudit(workDirAbs, {
        ts: new Date().toISOString(),
        tool,
        decision: 'error',
        summary: message,
      });
    }
    return `ERROR: ${redactSecrets(message)}`;
  }

  private scan(tool: string, text: string): Promise<string> | string | null {
    const hit = scanForHighRisk({
      tool,
      text,
      networkBlacklist: this.networkBlacklist(),
    });
    if (!hit) return null;
    return this.deny(tool, hit.message, hit.id, text.slice(0, 500));
  }

  private async toolList(args: Record<string, unknown>): Promise<string> {
    const workDirAbs = this.requireWorkDir();
    const rel = String(args.path ?? '.');
    const denied = await this.scan('pe_list', rel);
    if (denied) return denied;
    const resolved = resolveInWorkDir(workDirAbs, rel);
    if (!resolved.ok) return this.deny('pe_list', resolved.reason, 'path.escape', rel);
    const st = statSync(resolved.abs);
    if (!st.isDirectory()) return this.errorOutcome('pe_list', 'not a directory');
    const names = readdirSync(resolved.abs);
    this.allowAudit('pe_list', `list ${resolved.rel}`);
    return names.join('\n') || '(empty)';
  }

  private async toolRead(args: Record<string, unknown>): Promise<string> {
    const workDirAbs = this.requireWorkDir();
    const rel = String(args.path ?? '');
    const denied = await this.scan('pe_read', rel);
    if (denied) return denied;
    const resolved = resolveInWorkDir(workDirAbs, rel);
    if (!resolved.ok) return this.deny('pe_read', resolved.reason, 'path.escape', rel);
    const st = statSync(resolved.abs);
    if (!st.isFile()) return this.errorOutcome('pe_read', 'not a file');
    if (st.size > this.opts.cfg.maxOutputBytes) {
      return this.errorOutcome('pe_read', `file larger than maxOutputBytes (${this.opts.cfg.maxOutputBytes})`);
    }
    const content = readFileSync(resolved.abs, 'utf8');
    this.allowAudit('pe_read', `read ${resolved.rel}`);
    return content;
  }

  private async toolWrite(args: Record<string, unknown>): Promise<string> {
    const workDirAbs = this.requireWorkDir();
    const rel = String(args.path ?? '');
    const content = String(args.content ?? '');
    const denied = await this.scan('pe_write', `${rel}\n${content}`);
    if (denied) return denied;
    const resolved = resolveInWorkDir(workDirAbs, rel, { allowMissing: true });
    if (!resolved.ok) return this.deny('pe_write', resolved.reason, 'path.escape', rel);
    // 禁止覆盖钩子与审计目录外的敏感内部文件以外——允许写工作区；禁止删掉钩子后无防护：写 sitecustomize 仍允许但会再注入
    mkdirSync(dirname(resolved.abs), { recursive: true });
    writeFileSync(resolved.abs, content, 'utf8');
    this.allowAudit('pe_write', `write ${resolved.rel} (${content.length} chars)`);
    return `wrote ${resolved.rel} (${content.length} chars)`;
  }

  private async toolDelete(args: Record<string, unknown>): Promise<string> {
    const workDirAbs = this.requireWorkDir();
    const rel = String(args.path ?? '');
    const denied = await this.scan('pe_delete', rel);
    if (denied) return denied;
    const resolved = resolveInWorkDir(workDirAbs, rel);
    if (!resolved.ok) return this.deny('pe_delete', resolved.reason, 'path.escape', rel);
    if (resolved.rel === '.' || resolved.abs === workDirAbs) {
      return this.deny('pe_delete', 'refusing to delete the work directory root', 'path.root');
    }
    const st = statSync(resolved.abs);
    if (st.isDirectory()) {
      const kids = readdirSync(resolved.abs);
      if (kids.length > 0) return this.errorOutcome('pe_delete', 'directory is not empty');
      rmSync(resolved.abs);
    } else {
      rmSync(resolved.abs);
    }
    this.allowAudit('pe_delete', `delete ${resolved.rel}`);
    return `deleted ${resolved.rel}`;
  }

  private async toolRunPython(args: Record<string, unknown>): Promise<string> {
    const workDirAbs = this.requireWorkDir();
    const script = args.script != null ? String(args.script) : '';
    const code = args.code != null ? String(args.code) : '';
    const extra = Array.isArray(args.args) ? args.args.map(String) : [];
    if ((script && code) || (!script && !code)) {
      return this.errorOutcome('pe_run_python', 'provide exactly one of script or code');
    }
    const scanText = script || code;
    const denied = await this.scan('pe_run_python', `${scanText}\n${extra.join(' ')}`);
    if (denied) return denied;

    const py = this.venvPython(workDirAbs);
    if (!existsSync(py)) return this.errorOutcome('pe_run_python', 'venv python missing; is the World started?');

    let command: string;
    if (script) {
      const resolved = resolveInWorkDir(workDirAbs, script);
      if (!resolved.ok) return this.deny('pe_run_python', resolved.reason, 'path.escape', script);
      // 对脚本正文再扫一遍
      try {
        const body = readFileSync(resolved.abs, 'utf8');
        const bodyHit = await this.scan('pe_run_python', body);
        if (bodyHit) return bodyHit;
      } catch {
        /* 读失败留给运行时报 */
      }
      command = [quoteCmd(py), quoteCmd(resolved.rel), ...extra.map(quoteCmd)].join(' ');
    } else {
      command = `${quoteCmd(py)} -c ${quoteCmd(code)}`;
    }

    return this.runCommand('pe_run_python', command, workDirAbs);
  }

  private async toolPip(args: Record<string, unknown>): Promise<string> {
    const workDirAbs = this.requireWorkDir();
    const action = String(args.action ?? '');
    const packages = Array.isArray(args.packages) ? args.packages.map(String) : [];
    if (!['install', 'uninstall', 'list', 'show'].includes(action)) {
      return this.errorOutcome('pe_pip', 'action must be install|uninstall|list|show');
    }
    if ((action === 'install' || action === 'uninstall' || action === 'show') && packages.length === 0) {
      return this.errorOutcome('pe_pip', `packages required for ${action}`);
    }
    const denied = await this.scan('pe_pip', `${action} ${packages.join(' ')}`);
    if (denied) return denied;

    const pip = this.venvPip(workDirAbs);
    if (!existsSync(pip)) return this.errorOutcome('pe_pip', 'venv pip missing; is the World started?');

    const q = packages.map(quoteCmd);
    let command: string;
    switch (action) {
      case 'install':
        command = [quoteCmd(pip), 'install', ...q].join(' ');
        break;
      case 'uninstall':
        command = [quoteCmd(pip), 'uninstall', '-y', ...q].join(' ');
        break;
      case 'list':
        command = `${quoteCmd(pip)} list`;
        break;
      case 'show':
        command = [quoteCmd(pip), 'show', ...q].join(' ');
        break;
      default:
        return this.errorOutcome('pe_pip', 'bad action');
    }
    return this.runCommand('pe_pip', command, workDirAbs);
  }

  private async toolShell(args: Record<string, unknown>): Promise<string> {
    const workDirAbs = this.requireWorkDir();
    const commandLine = String(args.command ?? '');
    const denied = await this.scan('pe_shell', commandLine);
    if (denied) return denied;
    const parsed = parseRestrictedShell(commandLine);
    if (!parsed.ok) return this.deny('pe_shell', parsed.reason, 'shell.restricted', commandLine);

    // 对带路径的参数做越界检查
    for (const token of parsed.argv.slice(1)) {
      if (token.startsWith('-')) continue;
      if (/[\\/]/.test(token) || /\.[a-z0-9]+$/i.test(token)) {
        const r = resolveInWorkDir(workDirAbs, token, { allowMissing: true });
        if (!r.ok) return this.deny('pe_shell', r.reason, 'path.escape', token);
      }
    }

    const mapped = mapShellArgvToCommand(parsed.argv, {
      pythonExe: this.venvPython(workDirAbs),
      pipExe: this.venvPip(workDirAbs),
    });
    if (!mapped.ok) return this.deny('pe_shell', mapped.reason, 'shell.restricted', commandLine);
    return this.runCommand('pe_shell', mapped.command, workDirAbs);
  }

  /**
   * 执行位置策略（见 pythonExecution）：
   * - Windows + 沙箱模式：pip 仍在宿主；python/shell 进 MXC。
   * - Linux + 沙箱模式（mxc/bwrap）：pip / python / shell 均进 bwrap。
   * - host：python/shell/pip（若走到此处）均宿主。
   */
  private shouldRunOnHost(tool: string, command: string): boolean {
    const sandbox = isSandboxExecution(this.opts.cfg.pythonExecution);
    if (!sandbox) {
      return tool === 'pe_run_python' || tool === 'pe_shell' || tool === 'pe_pip';
    }
    // 沙箱模式
    if (process.platform === 'linux') return false;
    // Windows：pip 留宿主
    if (tool === 'pe_pip') return true;
    if (tool === 'pe_shell' && /(^|[\s"'])pip(\.exe)?\b/i.test(command)) return true;
    return false;
  }

  private async runCommand(tool: string, command: string, workDirAbs: string): Promise<string> {
    this.injectSitecustomize(workDirAbs);
    const injectedTestRunner = this.runner && !isPlatformSandboxRunner(this.runner);
    const onHost = !injectedTestRunner && this.shouldRunOnHost(tool, command);

    let result: RunResult;
    try {
      if (onHost) {
        const timeoutMs = Math.max(
          this.opts.cfg.commandTimeoutMs,
          tool === 'pe_pip' || /\bpip(\.exe)?\b/i.test(command) ? 600_000 : this.opts.cfg.commandTimeoutMs,
        );
        writeDebug(workDirAbs, 'info', 'run on host', {
          tool,
          command,
          timeoutMs,
          pythonExecution: this.opts.cfg.pythonExecution,
          reason:
            process.platform === 'win32' && (tool === 'pe_pip' || /\bpip(\.exe)?\b/i.test(command))
              ? 'Windows: pip stays on host'
              : 'pythonExecution=host',
        });
        result = await runOnHost({
          command,
          cwd: workDirAbs,
          env: this.sandboxEnv(workDirAbs),
          timeoutMs,
        });
        writeDebugOutputFiles(workDirAbs, `host-${tool}`, result);
      } else {
        if (!this.runner) this.runner = createSandboxRunner();
        const readonlyPaths = this.hostPythonReadonlyPaths();
        const hardenUi = process.platform === 'win32' && this.opts.cfg.hardenUi === true;
        const pipTimeout =
          tool === 'pe_pip' || /\bpip(\.exe)?\b/i.test(command)
            ? Math.max(this.opts.cfg.commandTimeoutMs, 600_000)
            : this.opts.cfg.commandTimeoutMs;
        writeDebug(workDirAbs, 'info', 'run in sandbox', {
          tool,
          command,
          pythonExecution: this.opts.cfg.pythonExecution,
          containment: this.opts.cfg.containment,
          hardenUi,
          platform: process.platform,
        });
        result = await this.runner.run({
          command,
          cwd: workDirAbs,
          workDirAbs,
          readonlyPaths,
          timeoutMs: pipTimeout,
          containment: this.opts.cfg.containment,
          hardenUi,
          env: this.sandboxEnv(workDirAbs),
        });
      }
    } catch (e) {
      return this.errorOutcome(tool, e instanceof Error ? e.message : String(e));
    }
    this.allowAudit(tool, command);
    const meaning = process.platform === 'win32' ? describeWindowsExitCode(result.exitCode) : undefined;
    const out = clip(
      `exit=${result.exitCode}${meaning ? ` (${meaning})` : ''} timedOut=${result.timedOut}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
      this.opts.cfg.maxOutputBytes,
    );
    return redactSecrets(out);
  }
}

function quoteCmd(s: string): string {
  if (!/[ \t"]/g.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}

function uniqueComma(paths: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const key = p.replace(/[\\/]+$/, '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out.join(',');
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n… truncated to ${max} bytes`;
}
