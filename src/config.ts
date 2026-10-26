import type { ConfigGroup } from 'cortico/core/types.ts';

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
   * Python/shell 执行位置（不含 pip）。
   * - mxc（默认）：进 MXC，强隔离；默认 `hardenUi=false` 时可 `import ssl` / HTTPS。
   * - host：仅作显式降级，失去 MXC 兜底，不推荐日常使用。
   * pip 固定在宿主执行（安装面与任意代码执行面分离）。
   */
  pythonExecution: 'host' | 'mxc';
  /**
   * MXC UI 硬化：`true` 时 `ui.disable`（关 Win32k），隔离更强，但常导致 `_ssl` DLL 初始化失败。
   * 默认 `false`：保留 clipboard/injection 限制，HTTPS 可用。热改（下次 run 生效）。
   */
  hardenUi: boolean;
  /** 隔离后端：`process`（processcontainer）。其它后端见后续方案。重启生效。 */
  containment: 'process' | 'windows_sandbox';
  /** 是否把拒绝等推到事件流。热改。 */
  auditToEvents: boolean;
}

export const PYTHONENV_DEFAULTS: PythonEnvConfigSection = {
  enabled: false,
  workDir: '',
  commandTimeoutMs: 60_000,
  maxOutputBytes: 65_536,
  pythonPath: '',
  pythonExecution: 'mxc',
  hardenUi: false,
  containment: 'process',
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
        description: '用于创建工作目录 venv 的 Python；留空则用 PATH 中的 python。改后需重启本 World。',
        'x-hot': false,
        'x-path': { kind: 'file', extensions: ['.exe'] },
      },
      'worlds.pythonenv.pythonExecution': {
        type: 'string',
        title: 'Python 执行位置',
        description:
          'mxc=默认强隔离（hardenUi 默认关时 HTTPS 可用）；host=显式降级到宿主（失去 MXC 兜底，不推荐）。pip 始终在宿主。',
        enum: ['host', 'mxc'],
        'x-hot': true,
      },
      'worlds.pythonenv.hardenUi': {
        type: 'boolean',
        title: '硬化 UI（关 Win32k）',
        description:
          '开启后 MXC 使用 ui.disable，UI 隔离更强，但常导致沙箱内 _ssl/HTTPS 失败。默认关闭以保留 HTTPS。',
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
