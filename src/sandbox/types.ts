export type ContainmentKind = 'process' | 'windows_sandbox' | 'bwrap';

export interface RunRequest {
  command: string;
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
  /** 可读写根：工作目录。 */
  workDirAbs: string;
  /** 额外只读路径（如宿主 Python 安装前缀），可选。 */
  readonlyPaths?: string[];
  /**
   * Windows：`process` = MXC processcontainer。
   * Linux：`bwrap`。
   * `windows_sandbox` 本版未实现。
   */
  containment: ContainmentKind;
  /**
   * Windows-only：true → MXC `ui.disable`（Win32k 关，SSL 常挂）。
   * Linux 忽略。
   */
  hardenUi?: boolean;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

/** 在隔离环境中执行一条命令。生产用 MXC / bwrap；测试可注入假实现。 */
export interface CommandRunner {
  run(req: RunRequest): Promise<RunResult>;
}
