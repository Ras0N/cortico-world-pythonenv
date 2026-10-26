export interface RunRequest {
  command: string;
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
  /** 可读写根：工作目录。 */
  workDirAbs: string;
  /** 额外只读路径（如宿主 Python 安装前缀），可选。 */
  readonlyPaths?: string[];
  containment: 'process' | 'windows_sandbox';
  /**
   * true → MXC `ui.disable`（Win32k 关，SSL 常挂）。
   * false/缺省 → 不关 Win32k，限制 clipboard / input injection。
   */
  hardenUi?: boolean;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

/** 在隔离环境中执行一条命令。生产用 MXC；测试可注入假实现。 */
export interface CommandRunner {
  run(req: RunRequest): Promise<RunResult>;
}
