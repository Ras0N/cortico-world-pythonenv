# cortico-world-pythonenv

该项目是一个 Cortico / Coopanion **World** 扩展。

功能：

1. 给Coopanaion提供一个封闭的python工作环境，在用户自选的工作目录内提供受限文件操作、python虚拟环境以及有限的shell功能；
2. 模型可以通过该插件联网，运行部分脚本；
3. 所有操作都将计入审计文件当中。


|          |                                                                                       |
| -------- | ------------------------------------------------------------------------------------- |
| 包名     | `cortico-world-pythonenv`                                                             |
| World id | `pythonenv`                                                                           |
| 工具前缀 | `pe_`                                                                                 |
| 平台     | **Windows**（MXC）；**Linux**（Debian 系 + Bubblewrap；Hyper-V / Coopanion 手测已过） |
| 契约     | `cortico.api` = 6                                                                     |

## 工作目录布局

| 路径          | 用途                                              |
| ------------- | ------------------------------------------------- |
| `venv/`       | Python 虚拟环境（解释器与 site-packages）         |
| `venv-state/` | 插件状态：`debug.log`、`audit.jsonl`、沙箱 `tmp/` |


## 系统要求

### 通用

- 已安装可用的 **Python 3**（用于创建工作目录下的 `venv`）。
- 运行 Coopanion / Cortico 的 Node：**≥ 22**（本包 `engines`）；Windows 上使用 MXC 时建议 **≥ 24**（MXC SDK 要求）。

### Windows

- 主机满足 [MXC](https://github.com/microsoft/mxc) **process containment** 要求。
- 隔离后端：`@microsoft/mxc-sdk`（MIT）。
- 默认 `pythonExecution=mxc`：Python / shell 进 MXC；**pip 仍在宿主**（安装面与执行面分离）。
- `hardenUi`：默认 `false`（保留 HTTPS）；`true` 时更强 UI 隔离但常导致 `_ssl` 失败。

### Linux（Debian 系）

目标发行版：

| 发行版 | 最低版本      |
| ------ | ------------- |
| Ubuntu | **22.04 LTS** |
| Debian | **13**        |

其它要求：

- **内核 > 5.0**，具备 **user namespace**（上述发行版默认满足；不做旧内核 / 无 userns 降级）。
- 系统已安装 **[bubblewrap](https://github.com/containers/bubblewrap)**（`bwrap`）。缺失时 **硬失败**，并提示安装。
- 系统 Python 需能建 venv 并带 pip。Debian/Ubuntu 请安装：

  ```bash
  sudo apt update
  sudo apt install -y bubblewrap python3 python3-venv python3-pip
  ```

- 隔离目标与 Windows MXC **对齐**：workDir 可写、宿主 Python 树只读、出站默许 + 网络黑名单软拦。
- **bubblewrap ≠ 虚拟机**：进程级命名空间隔离（工作目录可写 + 系统树只读），不是完整 guest OS。
- `pythonExecution` 取值：`mxc` / `bwrap` / `host`。`mxc` 与 `bwrap` 均表示进平台沙箱（Windows 跑 MXC，Linux 跑 bubblewrap）；默认 Windows=`mxc`、Linux=`bwrap`。Linux 上 **Python / pip / shell 均在 bwrap 内**。

## 配置（`worlds.pythonenv`）

- `workDir`：工作目录绝对路径（必填才能 `start`）
- `pythonExecution`：`mxc` | `bwrap` | `host`（后两者见上；`host` 失去沙箱兜底，不推荐）
- `hardenUi`：仅 Windows 有意义；默认 `false`；Linux 忽略
- `commandTimeoutMs` / `maxOutputBytes` / `pythonPath` / `containment`（Windows：`process`；Linux：`bwrap`）/ `auditToEvents`

### 提示词页（与环境提示词同级）

- **环境提示词**：`ENV_PROMPT.md`（注入系统前缀）
- **网络黑名单**：`NETWORK_BLACKLIST.md`（每行一个域名/后缀，`#` 注释；保存到部署目录 `worlds/pythonenv/`；工具扫描 + `pythonenv_hooks`；改后下次命令生效）

## 工具

`pe_list` `pe_read` `pe_write` `pe_delete` `pe_run_python` `pe_pip` `pe_shell`

## 开发

```bash
corepack pnpm install
pnpm test
```

Linux 验收（需已安装 `bubblewrap` + `python3`）：

```bash
sudo apt update && sudo apt install -y bubblewrap python3
pnpm smoke:bwrap          # 最小：bwrap + import ssl
pnpm smoke:bwrap:accept   # hooks / HTTPS / FS / 黑名单 / pip list / pip install six
```

**venv 策略**：两平台均在**宿主**创建 `workDir/venv`；Windows 运行期 MXC（pip 仍宿主），Linux 运行期 bwrap（python/pip/shell 均进沙箱）。

**Linux 钩子**：`venv/.../site-packages/pythonenv_hooks.py`，由 `pythonenv_hooks.pth` 加载（避免 Debian/Ubuntu 标准库自带 `sitecustomize` 抢名）。

第三方来源与许可证见 [THIRD_PARTY.md](./THIRD_PARTY.md)。

## 常见问题

- **创建 venv 立刻失败，`exitCode: -1073741515`（Windows）**：`STATUS_DLL_NOT_FOUND`。需只读映射宿主 Python 安装目录；本扩展按「宿主 Python」自动加入 `readonlyPaths`。
- **`_ssl` / HTTPS（Windows）**：默认 **`hardenUi=false`**，MXC 内可用。开启 `hardenUi` 常导致 `_ssl` 失败。Windows 上 `pip` 仍在宿主。
- **Linux 提示缺少 bwrap**：按上文安装 `bubblewrap`；本扩展不会在缺省时静默改用宿主执行。
- **Linux `pnpm smoke:bwrap` 失败**：看输出里的 `stderrHead`；常见原因是 userns 被发行版策略关掉（Ubuntu/Debian 桌面默认通常可用），或 `/bin/sh`/`python3` 未进只读绑定树。
- **沙箱内 `Temporary failure in name resolution`**：一般是 systemd-resolved 的 `/etc/resolv.conf` 软链断了（需绑定 `/run/systemd/resolve`）。**不是**网络黑名单（黑名单会报 `pythonenv: host on network blacklist`）。本扩展 0.1.8+ 已绑 DNS 相关路径。
- **HTTPS 一直卡住直到 timedOut，且已能 `import ssl`**：常见于 Hyper-V/VM **IPv6 黑洞**。Linux 沙箱默认 `PYTHONENV_PREFER_IPV4=1`，并通过覆盖 `/etc/gai.conf` 让 **glibc getaddrinfo（含 C 层）** 优先 IPv4。可在宿主对照：`curl -4 -I https://pypi.org` vs `curl -6 -I https://pypi.org`。
- **写 `/etc/passwd` 报 `Read-only file system`**：这是 bwrap 把 `/etc` 只读挂进来的预期结果（与 hooks 拒绝越界写入同属“禁止写出 workDir”）。
- **验收 `hook False` / sitecustomize 未加载（Debian/Ubuntu）**：发行版在标准库路径自带 `sitecustomize`（apport），会挡住 venv 里的同名文件。0.1.12+ 改为 `pythonenv_hooks.pth` 加载。
- **`pe_pip install` 报 `refusing path ... '/etc/debian_version'`**：钩子曾过严拦截 `/etc` 只读。0.1.13+ 放行读 `/etc`（写仍禁止）。重启 World 以重新注入 hooks。
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
