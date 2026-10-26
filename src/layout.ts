/** 工作目录内布局：虚拟环境与插件状态统一用 venv 前缀命名（与 World id `pythonenv` 无关）。 */
export const VENV_DIR = 'venv';
/** 审计、调试日志、沙箱 TEMP（不放进解释器树，以免被 pip/venv 清掉）。 */
export const VENV_STATE_DIR = 'venv-state';
