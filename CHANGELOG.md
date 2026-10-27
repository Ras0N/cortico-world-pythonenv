## 0.1.12

- Load FS/net hooks via `pythonenv_hooks.pth` → `pythonenv_hooks` (not only `sitecustomize.py`). Debian/Ubuntu ship a stdlib `sitecustomize` (apport) that shadows the venv copy, so acceptance saw `hook False` and FS denials fell through to bwrap RO only.

## 0.1.11

- Prefer IPv4 via bind-mounted `/etc/gai.conf` (glibc C getaddrinfo; sitecustomize-only patch was not enough). Prefer versioned `lib/python3.x/site-packages` when injecting sitecustomize. Acceptance: verify hook load; treat bwrap `Read-only file system` as valid FS deny.

## 0.1.10

- Linux: default `PYTHONENV_PREFER_IPV4=1` so sitecustomize prefers A records (avoids Hyper-V/VM IPv6 blackholes that hang `urlopen` until runner timeout with no exception).

## 0.1.9

- bwrap: set `PYTHONUNBUFFERED=1` and default `SSL_CERT_FILE` when present; bind `/var/lib/ca-certificates`. Acceptance HTTPS probe uses a script file with flushed diagnostics (empty stdout/stderr on fail was often buffering + kill).

## 0.1.8

- Fix bwrap DNS on systemd-resolved hosts: `--ro-bind-try` `/run/systemd/resolve` (and related paths) so `/etc/resolv.conf` symlinks keep working. Without this, HTTPS fails with `Temporary failure in name resolution` (not the blacklist).

## 0.1.7

- Linux venv bootstrap: use `python -m venv` (needs `python3-venv`); clear apt hint when `ensurepip` is missing (Debian/Ubuntu packaging, not a missing import). Shared `venv-bootstrap.ts` for World + acceptance script.

## 0.1.6

- Slice C alignment: early `bwrap` probe on Linux start; venv bootstrap stays on **host** (both platforms; Linux runtime still bwrap); `sitecustomize` allows readonly Python/CA prefixes via `PYTHONENV_READONLY_PREFIXES` while writes stay workDir-only; blacklist env unchanged; ENV_PROMPT documents MXC vs bwrap; `pnpm smoke:bwrap:accept` for VM (ssl/HTTPS/FS/blacklist/pip list).

## 0.1.5

- Fix bwrap: do not remount `/tmp` when `workDir` itself lives under `/tmp` (that hid the workDir and made `--chdir` fail with "No such file or directory"). Smoke test prefers `$HOME/.cache`.

## 0.1.4

- Slice B: Linux `BwrapCommandRunner` — detect `bwrap` (hard-fail + `apt install bubblewrap` hint), argv (`--die-with-parent`, unshare pid/uts/ipc, no `--unshare-net`, system `--ro-bind-try`, bind workDir, `/tmp`→`venv-state/tmp`, clearenv + whitelist), timeout kills process group. `pnpm smoke:bwrap` for VM checks.

## 0.1.3

- Slice A (Linux prep): `createSandboxRunner()` (win32→MXC, linux→Bwrap stub), `pythonExecution` = `mxc|bwrap|host`, cross-platform venv/`python-home`/`pe_shell` mapping, `os: [win32, linux]`, MXC as optionalDependency. Linux pip goes through sandbox when not `host`. Bwrap execution lands in slice B.

## 0.1.2

- Move network blacklist out of config into a prompt-doc editor (`NETWORK_BLACKLIST.md`, same WebUI tab as the env prompt). Legacy `worlds.pythonenv.networkBlacklist` migrates once on start. Remove diagnostic `scripts/` probes.

## 0.1.1

- Fix MXC HTTPS: default `hardenUi=false` (no `ui.disable` / Win32k mitigation); keep clipboard and input-injection limits. Optional `hardenUi=true` restores stronger UI isolation at the cost of `_ssl`.

## 0.1.0

- Initial Windows release: MXC process containment, work-dir file tools, `venv/` Python/pip, restricted shell, rule-based deny, `venv-state/` audit/debug, env prompt guidelines.
- Map host Python as MXC readonlyPaths; point TEMP into `venv-state/tmp` for ensurepip; layout renamed from `.venv` / `.pythonenv`.
