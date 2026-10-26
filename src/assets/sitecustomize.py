# cortico-world-pythonenv — Python defense-in-depth hooks (MIT, same as the package).
# Loaded via site.addsitedir / site-packages sitecustomize.
# Blocks file opens outside PYTHONENV_WORKDIR and network connects to PYTHONENV_NET_BLACKLIST.
# Native extensions that bypass Python I/O are not covered; MXC FS policy is the primary control.

from __future__ import annotations

import builtins
import os
import sys

_WORKDIR = os.environ.get("PYTHONENV_WORKDIR", "").strip()
_BLACKLIST = [
    x.strip().lower()
    for x in os.environ.get("PYTHONENV_NET_BLACKLIST", "").split(",")
    if x.strip()
]


def _norm(p: str) -> str:
    return os.path.normcase(os.path.realpath(p))


def _inside_work(path: str) -> bool:
    if not _WORKDIR:
        return False
    try:
        root = _norm(_WORKDIR)
        cand = _norm(path)
    except OSError:
        root = os.path.normcase(os.path.abspath(_WORKDIR))
        cand = os.path.normcase(os.path.abspath(path))
    return cand == root or cand.startswith(root + os.sep)


def _guard_path(path, mode="r"):
    if path is None:
        return
    p = path if isinstance(path, (str, bytes, os.PathLike)) else str(path)
    if isinstance(p, bytes):
        p = os.fsdecode(p)
    p = os.fspath(p)
    # Allow interpreter internals under the venv / workdir only.
    if not _inside_work(p):
        raise PermissionError(
            f"pythonenv: refusing path outside work directory: {p!r}"
        )


_orig_open = builtins.open


def _open(file, *args, **kwargs):
    _guard_path(file, args[0] if args else kwargs.get("mode", "r"))
    return _orig_open(file, *args, **kwargs)


builtins.open = _open

try:
    import io as _io

    _orig_io_open = _io.open

    def _io_open(file, *args, **kwargs):
        _guard_path(file)
        return _orig_io_open(file, *args, **kwargs)

    _io.open = _io_open  # type: ignore[assignment]
except Exception:
    pass

try:
    import os as _os

    _orig_os_open = _os.open

    def _os_open(path, flags, mode=0o777, *args, **kwargs):
        _guard_path(path)
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
except Exception:
    pass

# Marker for tests / diagnostics
sys.modules[__name__]._PYTHONENV_HOOK = True  # type: ignore[attr-defined]
