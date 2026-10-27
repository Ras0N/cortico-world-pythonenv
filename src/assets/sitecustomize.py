# cortico-world-pythonenv — Python defense-in-depth hooks (MIT, same as the package).
# Installed as site-packages/pythonenv_hooks.py and loaded via pythonenv_hooks.pth
# (Debian/Ubuntu ship a stdlib sitecustomize for apport that shadows venv sitecustomize.py).
# Also copied as sitecustomize.py where that name is free; imports are idempotent.
# - Writes: only inside PYTHONENV_WORKDIR.
# - Reads: workdir + PYTHONENV_READONLY_PREFIXES (host Python / system libs) + TLS trust stores.
# Primary FS isolation is MXC (Windows) or bubblewrap (Linux); this is a second line of defense.
# Native code that bypasses Python I/O is not covered.

from __future__ import annotations

import builtins
import os
import sys

# Both sitecustomize.py and pythonenv_hooks.pth may load this file; patch once.
if getattr(sys, "_pythonenv_hook", False):
    pass
else:
    _WORKDIR = os.environ.get("PYTHONENV_WORKDIR", "").strip()
    _BLACKLIST = [
        x.strip().lower()
        for x in os.environ.get("PYTHONENV_NET_BLACKLIST", "").split(",")
        if x.strip()
    ]
    _READONLY_PREFIXES = [
        x.strip()
        for x in os.environ.get("PYTHONENV_READONLY_PREFIXES", "").split(",")
        if x.strip()
    ]
    # Always allow interpreter trees + common CA paths (HTTPS inside bwrap/MXC).
    for _cand in (
        getattr(sys, "base_prefix", "") or "",
        getattr(sys, "base_exec_prefix", "") or "",
        sys.prefix,
        sys.exec_prefix,
        "/etc/ssl",
        "/etc/pki",
        "/usr/share/ca-certificates",
    ):
        if _cand and _cand not in _READONLY_PREFIXES:
            _READONLY_PREFIXES.append(_cand)

    def _norm(p: str) -> str:
        return os.path.normcase(os.path.realpath(p))

    def _inside(root: str, path: str) -> bool:
        try:
            r = _norm(root)
            cand = _norm(path)
        except OSError:
            r = os.path.normcase(os.path.abspath(root))
            cand = os.path.normcase(os.path.abspath(path))
        return cand == r or cand.startswith(r + os.sep)

    def _inside_work(path: str) -> bool:
        return bool(_WORKDIR) and _inside(_WORKDIR, path)

    def _inside_readonly(path: str) -> bool:
        for root in _READONLY_PREFIXES:
            if _inside(root, path):
                return True
        return False

    def _is_write_mode(mode) -> bool:
        if mode is None:
            return False
        if isinstance(mode, (bytes, bytearray)):
            mode = mode.decode("ascii", "replace")
        m = str(mode)
        # r+ / w / a / x 会改文件；纯 r / rb 只读
        return any(ch in m for ch in ("w", "a", "x", "+"))

    def _guard_path(path, mode="r"):
        if path is None:
            return
        p = path if isinstance(path, (str, bytes, os.PathLike)) else str(path)
        if isinstance(p, bytes):
            p = os.fsdecode(p)
        p = os.fspath(p)
        if _inside_work(p):
            return
        writing = _is_write_mode(mode)
        if not writing and _inside_readonly(p):
            return
        raise PermissionError(
            f"pythonenv: refusing path outside work directory: {p!r}"
        )

    _orig_open = builtins.open

    def _open(file, *args, **kwargs):
        mode = args[0] if args else kwargs.get("mode", "r")
        _guard_path(file, mode)
        return _orig_open(file, *args, **kwargs)

    builtins.open = _open

    try:
        import io as _io

        _orig_io_open = _io.open

        def _io_open(file, *args, **kwargs):
            mode = args[0] if args else kwargs.get("mode", "r")
            _guard_path(file, mode)
            return _orig_io_open(file, *args, **kwargs)

        _io.open = _io_open  # type: ignore[assignment]
    except Exception:
        pass

    try:
        import os as _os

        _orig_os_open = _os.open

        def _os_open(path, flags, mode=0o777, *args, **kwargs):
            # os.O_RDONLY == 0 on POSIX; treat any write-ish flag as write
            writing = bool(
                flags
                & (
                    getattr(_os, "O_WRONLY", 1)
                    | getattr(_os, "O_RDWR", 2)
                    | getattr(_os, "O_APPEND", 0)
                    | getattr(_os, "O_CREAT", 0)
                    | getattr(_os, "O_TRUNC", 0)
                )
            )
            _guard_path(path, "w" if writing else "r")
            return _orig_os_open(path, flags, mode, *args, **kwargs)

        _os.open = _os_open  # type: ignore[assignment]
    except Exception:
        pass

    def _host_blocked(host: str) -> bool:
        h = (host or "").strip().lower().rstrip(".")
        if not h or not _BLACKLIST:
            return False
        for entry in _BLACKLIST:
            e = entry[2:] if entry.startswith("*.") else entry
            if e.startswith("."):
                if h == e[1:] or h.endswith(e):
                    return True
            elif h == e or h.endswith("." + e):
                return True
        return False

    try:
        import socket as _socket

        _orig_cc = _socket.create_connection

        def _create_connection(address, *args, **kwargs):
            host = address[0] if isinstance(address, tuple) else address
            if isinstance(host, (bytes, bytearray)):
                host = host.decode("utf-8", "replace")
            if _host_blocked(str(host)):
                raise PermissionError(f"pythonenv: host on network blacklist: {host!r}")
            return _orig_cc(address, *args, **kwargs)

        _socket.create_connection = _create_connection  # type: ignore[assignment]

        # Hyper-V / 部分 VM：AAAA 路由黑洞时 urlopen 会先卡在 IPv6，远超 timeout 才失败。
        # PYTHONENV_PREFER_IPV4=1（Linux 沙箱默认）时，family=0 优先只解析 IPv4。
        _prefer_v4 = os.environ.get("PYTHONENV_PREFER_IPV4", "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        if _prefer_v4:
            _orig_gai = _socket.getaddrinfo

            def _getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
                if family == 0:
                    v4 = _orig_gai(host, port, _socket.AF_INET, type, proto, flags)
                    if v4:
                        return v4
                return _orig_gai(host, port, family, type, proto, flags)

            _socket.getaddrinfo = _getaddrinfo  # type: ignore[assignment]
    except Exception:
        pass

    # Marker for tests / diagnostics (sys attr survives module-name clashes)
    sys._pythonenv_hook = True  # type: ignore[attr-defined]
    sys.modules[__name__]._PYTHONENV_HOOK = True  # type: ignore[attr-defined]
