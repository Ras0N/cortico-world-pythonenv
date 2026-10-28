# Third-party notices

## Cortico World extension template

- Source: [Pal-AI-Lab/Cortico `templates/extension/world`](https://github.com/Pal-AI-Lab/Cortico/tree/main/templates/extension/world)
- Used as the starting package layout and test harness patterns.
- License: follow the Cortico repository license for that template.

## @microsoft/mxc-sdk (Microsoft eXecution Containers)

- Package: [`@microsoft/mxc-sdk`](https://www.npmjs.com/package/@microsoft/mxc-sdk)
- Source: [github.com/microsoft/mxc](https://github.com/microsoft/mxc)
- License: **MIT** (Copyright (c) Microsoft Corporation) — see the package `LICENSE.md`.
- Role: Windows process-level sandbox for running Python / pip / restricted shell inside the work directory.

## bubblewrap (system dependency, Linux)

- Project: [containers/bubblewrap](https://github.com/containers/bubblewrap)
- License: **LGPL-2.0-or-later** (system package; **not** vendored into this npm package).
- Role: Linux **process** sandbox (`bwrap`) for `pythonExecution=bwrap|mxc` on Debian/Ubuntu — namespaces + bind mounts, **not** a full VM.
- Install: `sudo apt install bubblewrap`
