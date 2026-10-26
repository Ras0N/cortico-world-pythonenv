import type { ConfigGroup } from 'cortico/core/types.ts';
import type { ContainmentKind } from './sandbox/types.ts';

/** 进平台沙箱：Windows 用 mxc，Linux 用 bwrap；host = 显式降级。 */
export type PythonExecution = 'mxc' | 'bwrap' | 'host';

/** config.json 的 worlds.pythonenv 段；默认禁用。 */
export interface PythonEnvConfigSection {
  enabled: boolean;
  /** 工作目录绝对路径；未配置时 start 失败。`x-hot: false`：改后需重启 World。 */
  workDir: string;
  /**
   * @deprecated 已迁到提示词页的 NETWORK_BLACKLIST.md；仅用于启动时一次性迁移。
   * 仍可能出现在旧 config.json 里，不进 WebUI schema。
   */
  networkBlacklist?: string;
  /** 命令超时（毫秒）。热改。pip 安装另有不低于 10 分钟的下限。 */
  commandTimeoutMs: number;
  /** 工具回执截断字节数。热改。 */
  maxOutputBytes: number;
  /** 宿主 Python 可执行文件；空则用 PATH 上的 python。重启生效。 */
  pythonPath: string;
  /**
   * 执行位置：
   * - `mxc` / `bwrap`：进平台沙箱（Win=MXC，Linux=bubblewrap；二者均表示沙箱模式）。
   * - `host`：显式降级，失去沙箱兜底，不推荐。
   * Windows：pip 仍在宿主；Linux：pip 也进 bwrap（与 Python/shell 一致）。
   */
  pythonExecution: PythonExecution;
  /**
   * Windows-only：MXC `ui.disable`。Linux 忽略。
   * 默认 `false`。热改（下次 run 生效）。
   */
  hardenUi: boolean;
  /** 隔离后端。Windows：`process`；Linux：`bwrap`。重启生效。 */
  containment: ContainmentKind;
  /** 是否把拒绝等推到事件流。热改。 */
  auditToEvents: boolean;
}

export function defaultPythonExecution(platform: NodeJS.Platform = process.platform): PythonExecution {
  return platform === 'linux' ? 'bwrap' : 'mxc';
}

export function defaultContainment(platform: NodeJS.Platform = process.platform): ContainmentKind {
  return platform === 'linux' ? 'bwrap' : 'process';
}

/** 是否为「进沙箱」配置（相对 host）。 */
export function isSandboxExecution(exec: PythonExecution | undefined): boolean {
  return exec === 'mxc' || exec === 'bwrap';
}

export const PYTHONENV_DEFAULTS: PythonEnvConfigSection = {
  enabled: false,
  workDir: '',
  commandTimeoutMs: 60_000,
  maxOutputBytes: 65_536,
  pythonPath: '',
  pythonExecution: defaultPythonExecution(),
  hardenUi: false,
  containment: defaultContainment(),
  auditToEvents: true,
};

export const PYTHONENV_CONFIG_GROUP: ConfigGroup = {
  id: 'world:pythonenv',
  owner: 'world:pythonenv',
  schema: {
    type: 'object',
    title: 'Python Env',
    properties: {
      'worlds.pythonenv.workDir': {
        type: 'string',
        title: '工作目录',
        description: '沙箱可读写的唯一本机目录（绝对路径）。改后需重启本 World。',
        'x-hot': false,
        'x-path': { kind: 'directory' },
      },
      'worlds.pythonenv.commandTimeoutMs': {
        type: 'integer',
        title: '命令超时（毫秒）',
        minimum: 1000,
        'x-hot': true,
      },
      'worlds.pythonenv.maxOutputBytes': {
        type: 'integer',
        title: '输出截断（字节）',
        minimum: 1024,
        'x-hot': true,
      },
      'worlds.pythonenv.pythonPath': {
        type: 'string',
        title: '宿主 Python',
        description: '用于创建工作目录 venv 的 Python；留空则用 PATH 中的 python / python3。改后需重启本 World。',
        'x-hot': false,
        'x-path': { kind: 'file' },
      },
      'worlds.pythonenv.pythonExecution': {
        type: 'string',
        title: '执行位置',
        description:
          'mxc / bwrap = 进平台沙箱（Windows→MXC，Linux→bubblewrap）；host = 显式降级（不推荐）。Windows 上 pip 仍在宿主；Linux 上 pip 也进 bwrap。',
        enum: ['mxc', 'bwrap', 'host'],
        'x-hot': true,
      },
      'worlds.pythonenv.hardenUi': {
        type: 'boolean',
        title: '硬化 UI（仅 Windows）',
        description:
          '仅 MXC：开启后 ui.disable，UI 隔离更强，但常导致 _ssl/HTTPS 失败。Linux 忽略。默认关闭。',
        'x-hot': true,
      },
      'worlds.pythonenv.containment': {
        type: 'string',
        title: '隔离后端',
        description: 'Windows 用 process（MXC processcontainer）；Linux 用 bwrap。windows_sandbox 未实现。',
        enum: ['process', 'bwrap', 'windows_sandbox'],
        'x-hot': false,
      },
      'worlds.pythonenv.auditToEvents': {
        type: 'boolean',
        title: '拒绝时推送事件',
        'x-hot': true,
      },
    },
  },
};
