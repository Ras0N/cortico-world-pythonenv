import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { PYTHONENV_DEFAULTS, type PythonEnvConfigSection } from './config.ts';
import { PYTHONENV_TOOL_DECLS, PythonEnvWorld } from './world.ts';

export const PYTHONENV: WorldDefinition<PythonEnvConfigSection> = {
  id: 'pythonenv',
  label: 'Python Env',
  defaults: () => ({ ...PYTHONENV_DEFAULTS }),
  create: (ctx) => new PythonEnvWorld({ cfg: ctx.cfg, timezone: ctx.timezone }),
  describe: {
    tools: describeTools(PYTHONENV_TOOL_DECLS, {
      pe_list: { zh: '列出工作目录内相对路径下的文件与文件夹。', en: 'List entries under a relative path in the work directory.' },
      pe_read: { zh: '读取工作目录内的文本文件。', en: 'Read a text file inside the work directory.' },
      pe_write: { zh: '写入工作目录内的文本文件。', en: 'Write a text file inside the work directory.' },
      pe_delete: { zh: '删除工作目录内的文件或空目录。', en: 'Delete a file or empty directory inside the work directory.' },
      pe_run_python: { zh: '用工作目录 venv 运行脚本或 -c 代码。', en: 'Run a script or -c with the work-dir venv Python.' },
      pe_pip: { zh: '对工作目录 venv 执行 pip install/uninstall/list/show。', en: 'pip install/uninstall/list/show against the work-dir venv.' },
      pe_shell: { zh: '在沙箱内运行白名单命令（无管道/重定向）。', en: 'Run one allowlisted command in the sandbox (no pipes/redirects).' },
    }),
    events: [
      { type: 'pythonenv.ready', description: { zh: '工作环境已就绪。', en: 'The Python Env workbench is ready.' } },
      { type: 'pythonenv.error', description: { zh: '启动或运行失败。', en: 'Start or runtime failure.' } },
      { type: 'pythonenv.denied', description: { zh: '高危或越界操作被拒绝。', en: 'A high-risk or out-of-bounds action was denied.' } },
    ],
  },
};
