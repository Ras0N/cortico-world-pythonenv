import type { ConfigGroup } from 'cortico/core/types.ts';

/** config.json 的 worlds.pythonenv 段；默认禁用。 */
export interface PythonEnvConfigSection {
  enabled: boolean;
  /** 工作目录绝对路径；未配置时 start 失败。`x-hot: false`：改后需重启 World。 */
  workDir: string;
  /**
   * 禁止访问的域名或后缀，逗号分隔（如 `evil.example,.internal`）。
   * WebUI 配置 schema 不支持字符串数组，故用单个 string。
   */
  networkBlacklist: string;
  /** 命令超时（毫秒）。热改。pip 安装另有不低于 10 分钟的下限。 */
  commandTimeoutMs: number;
  /** 工具回执截断字节数。热改。 */
  maxOutputBytes: number;
  /** 宿主 Python 可执行文件；空则用 PATH 上的 python。重启生效。 */
  pythonPath: string;
  /**
   * Python/shell 执行位置（不含 pip）。
   * - mxc（默认）：进 MXC，强隔离；当前 processcontainer 下 `_ssl` 常失败。
   * - host：仅作显式降级，失去 MXC 兜底，不推荐日常使用。
   * pip 固定在宿主执行（见方案讨论：安装面与任意代码执行面分离）。
   */
  pythonExecution: 'host' | 'mxc';
  /** 隔离后端：`process`（processcontainer）。其它后端见后续方案。重启生效。 */
  containment: 'process' | 'windows_sandbox';
  /** 是否把拒绝等推到事件流。热改。 */
  auditToEvents: boolean;
}

export const PYTHONENV_DEFAULTS: PythonEnvConfigSection = {
  enabled: false,
  workDir: '',
  networkBlacklist: '',
  commandTimeoutMs: 60_000,
  maxOutputBytes: 65_536,
  pythonPath: '',
  pythonExecution: 'mxc',
  containment: 'process',
  auditToEvents: true,
};

/** 解析逗号/空白分隔的黑名单。 */
export function parseBlacklist(raw: string | string[] | undefined): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  if (!raw) return [];
  return String(raw)
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

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
      'worlds.pythonenv.networkBlacklist': {
        type: 'string',
        title: '网络黑名单',
        description: '禁止访问的域名或后缀，逗号分隔。由工具校验与 Python 钩子执行。',
        'x-hot': true,
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
        description: '用于创建工作目录 venv 的 Python；留空则用 PATH 中的 python。改后需重启本 World。',
        'x-hot': false,
        'x-path': { kind: 'file', extensions: ['.exe'] },
      },
      'worlds.pythonenv.pythonExecution': {
        type: 'string',
        title: 'Python 执行位置',
        description:
          'mxc=默认强隔离（当前 processcontainer 下 HTTPS 常不可用）；host=显式降级到宿主（失去 MXC 兜底，不推荐）。pip 始终在宿主。',
        enum: ['host', 'mxc'],
        'x-hot': true,
      },
      'worlds.pythonenv.containment': {
        type: 'string',
        title: 'MXC 隔离后端',
        description: 'pythonExecution=mxc 时使用。当前仅 process（processcontainer）。',
        enum: ['process', 'windows_sandbox'],
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
