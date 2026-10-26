/** 包入口:默认导出 `WorldDefinition`,加载器按 `cortico.kind === 'world'` 认它。 */
import { PYTHONENV } from './definition.ts';

export default PYTHONENV;
export { PYTHONENV };
export type { PythonEnvConfigSection } from './config.ts';
export { PythonEnvWorld } from './world.ts';
