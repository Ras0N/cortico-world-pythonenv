## 0.1.3

- Slice A (Linux prep): `createSandboxRunner()` (win32→MXC, linux→Bwrap stub), `pythonExecution` = `mxc|bwrap|host`, cross-platform venv/`python-home`/`pe_shell` mapping, `os: [win32, linux]`, MXC as optionalDependency. Linux pip goes through sandbox when not `host`. Bwrap execution lands in slice B.

## 0.1.2

- Move network blacklist out of config into a prompt-doc editor (`NETWORK_BLACKLIST.md`, same WebUI tab as the env prompt). Legacy `worlds.pythonenv.networkBlacklist` migrates once on start. Remove diagnostic `scripts/` probes.

## 0.1.1

- Fix MXC HTTPS: default `hardenUi=false` (no `ui.disable` / Win32k mitigation); keep clipboard and input-injection limits. Optional `hardenUi=true` restores stronger UI isolation at the cost of `_ssl`.

## 0.1.0

- Initial Windows release: MXC process containment, work-dir file tools, `venv/` Python/pip, restricted shell, rule-based deny, `venv-state/` audit/debug, env prompt guidelines.
- Map host Python as MXC readonlyPaths; point TEMP into `venv-state/tmp` for ensurepip; layout renamed from `.venv` / `.pythonenv`.
