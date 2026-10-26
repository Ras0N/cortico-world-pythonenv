# AGENTS.md

Release checklist for cortico-world-pythonenv. See
[docs/worlds.md](https://github.com/Pal-AI-Lab/Cortico/blob/main/docs/worlds.md) and
[docs/extensions.md](https://github.com/Pal-AI-Lab/Cortico/blob/main/docs/extensions.md).

- [ ] `cortico.api` matches the world contract printed by `check:extension`.
- [ ] After changing tools/events/env prompt, refresh `describe.json` (`pnpm describe:extension` from a Cortico checkout).
- [ ] `os` stays accurate (`win32` until Linux/Bubblewrap lands).
- [ ] `CHANGELOG.md` has a `## <version>` section.
- [ ] Third-party notices in `THIRD_PARTY.md` stay accurate (MXC MIT, Cortico template).
- [ ] Do not ship user secrets; do not upload audit logs.
