# cortico-world-pythonenv

Cortico / Coopanion **World** 扩展：在用户自选的工作目录内提供受限文件操作、`venv` Python / pip、白名单 shell；Windows 下用 **MXC**（`@microsoft/mxc-sdk`，MIT）做进程隔离；规则特征命中则**默认拒绝**；审计写入工作目录 `venv-state/audit.jsonl`。不读取、不上传你的 API Key 或隐私数据。

| | |
|---|---|
| 包名 | `cortico-world-pythonenv` |
| World id | `pythonenv` |
| 工具前缀 | `pe_` |
| 平台（本版） | Windows（`os: win32`） |
| 契约 | `cortico.api` = 6 |

## 工作目录布局

| 路径 | 用途 |
|---|---|
| `venv/` | Python 虚拟环境（解释器与 site-packages） |
| `venv-state/` | 插件状态：`debug.log`、`audit.jsonl`、沙箱 `tmp/` |

World 配置段仍叫 `worlds.pythonenv`（Cortico id）；与上述文件夹名无关。

## 前提

- Windows，且主机满足 [MXC](https://github.com/microsoft/mxc) process containment 要求。
- 已安装可用的 Python 3（用于创建工作目录下的 `venv`）。
- 运行 Coopanion / Cortico 的 Node 建议 **≥ 24**（MXC SDK 要求）；本包 `engines` 写 ≥22 以兼容 Cortico 扩展约定。

## 配置（`worlds.pythonenv`）

- `workDir`：工作目录绝对路径（必填才能 `start`）
- `networkBlacklist`：域名/后缀黑名单，**逗号分隔**字符串（工具扫描 + Python `sitecustomize` 钩子；MXC 网络规则为 CIDR，本版 egress 默认允许）
- `commandTimeoutMs` / `maxOutputBytes` / `pythonPath` / `containment`（仅 `process`）/ `auditToEvents`

## 工具

`pe_list` `pe_read` `pe_write` `pe_delete` `pe_run_python` `pe_pip` `pe_shell`

## 开发

```bash
corepack pnpm install
pnpm test
```

第三方来源与许可证见 [THIRD_PARTY.md](./THIRD_PARTY.md)。

## 常见问题

- **创建 venv 立刻失败，`exitCode: -1073741515`**：Windows `STATUS_DLL_NOT_FOUND`。需只读映射宿主 Python 安装目录；本扩展按「宿主 Python」自动加入 `readonlyPaths`。
- **`_ssl` / HTTPS 与隔离**：不要指望拷整份 runtime 进 venv。默认 **`pythonExecution=mxc`**（强隔离）；`pip` 在宿主。需要 HTTPS 且保持隔离时，应走 VM/WSLC、宿主 TLS 代理或受控 `pe_http_*` 工具（见方案讨论），**不要**把默认改成 host 跑任意 Python。
- **日志很长被截断**：`debug.log` 行内只留摘要；完整 stdout/stderr 在 `venv-state/last-*-stdout.txt` 与 `last-*-stderr.txt`。

## 调试日志

- 摘要：`<workDir>/venv-state/debug.log`
- 完整命令输出：`<workDir>/venv-state/last-*-stderr.txt`

同时会推送事件 `pythonenv.error`，并写入 Coopanion 进程日志（数据目录下的 `logs/`）。

## 在 Coopanion 里从本机目录安装

1. 打开 Coopanion → **扩展**页  
2. 选择类别 **World**，用「手动安装 / 本机目录」填入本包的**绝对路径**（例如 `E:\Coopanion_Plugin\cortico-world-pythonenv`）。
3. 安装成功后重启进程；在 World 总览启用 **Python Env**，设置 `workDir` 后再启用/重启该 World。
4. 改源码后重启进程即可（本机目录以 link 方式装入）。

不要用本助手代发 npm；是否发布由你决定。发布时 `package.json` 已含 `cortico-world` 关键字。
