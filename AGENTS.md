# AGENTS.md

Guidance for AI coding agents working on this repository.

## Project

Auto PiP Manager (`nextpinp@leonid.nasedkin`) is a GNOME Shell 51 extension that manages
Picture-in-Picture windows: always on top, on all workspaces, placed in / snapped to a screen
corner, rounded corners via a Clutter shader effect. Plain ES modules for GJS, no build step,
no runtime dependencies.

## Layout

- `extension.js` — all runtime logic. Pure helpers `isPiP`, `cornerPosition`, `nearestCorner`,
  `focusFallback` are exported for tests; `AutoPiPManager` (default export) wires signals in
  `enable()` and must undo everything in `disable()`.
- `prefs.js` — libadwaita preferences window; rows are bound to the settings with
  `settings.bind()`, spin row limits come from the schema `<range>`. Exports `CORNER_VALUES`
  and `cornerIndex` (used by tests).
- `schemas/org.gnome.shell.extensions.auto-pip-manager.gschema.xml` — settings keys:
  `corner`, `offset`, `always-on-top`, `always-on-all-workspaces`, `corner-radius`,
  `never-in-focus`, `do-not-show-on-overview`.
- `po/` — translations (`ru.po`); `po/POTFILES` lists source files with translatable strings.
- `tests/` — `node:test` unit tests; `stubs.mjs` + `setup.mjs` replace `gi://` and `resource://`
  imports so the extension modules load under Node. `extension.test.mjs` covers the pure
  helpers, `lifecycle.test.mjs` runs `enable()` / `disable()` against a fake `global`, GLib main
  loop and settings, `metadata.test.mjs` checks metadata, schema and translations.
- `build.sh` — builds `dist/<uuid>.shell-extension.zip`; `install.sh` — installs into
  `~/.local/share/gnome-shell/extensions/<uuid>`.
- `.github/workflows/ci.yml` — lint + test, build archive, GitHub release on `vN` tags.

## Commands

```bash
npm ci            # dev dependencies (ESLint)
npm run lint      # must pass
npm test          # must pass
./build.sh        # needs glib-compile-schemas, msgfmt, zip, python3
```

Run lint and tests before committing. Behaviour involving real windows cannot be tested under
Node; say so explicitly instead of claiming it works. Manual check: `./install.sh`, then a nested
session `dbus-run-session gnome-shell --devkit --wayland`.

## Conventions

- GJS / GNOME Shell extension rules apply (extensions.gnome.org review): create nothing in the
  module scope that needs cleanup, connect signals in `enable()`, disconnect them and remove
  every `GLib` source and shader effect in `disable()`. Track idle IDs in `_pendingIdles`.
- A window is PiP if and only if it is in `_trackedWindows`. `isPiP()` is evaluated once, when
  the window appears (or on `enable()` for open windows); never call it on live events, an
  ordinary window may get a PiP-like title later. Per-window signals, idles and the
  `first-frame` handler live in the window's record and are released in `_untrackWindow()`.
- New signal, source or per-window state: extend `tests/lifecycle.test.mjs`; its
  `assertCleanedUp()` fails if `disable()` leaves a handler, source or effect behind.
- Keep pure, testable logic in exported functions without GNOME dependencies and add tests for
  them in `tests/extension.test.mjs`. If a new `gi://` module or symbol is touched at import
  time, extend `tests/stubs.mjs`.
- 4-space indentation, single quotes, ES2024 modules; unused arguments start with `_`.
- New setting: add the key to the schema, a row in `prefs.js`, strings to every `po/*.po`,
  the key list in `tests/metadata.test.mjs`, and the settings table in both READMEs.
- New user-visible strings in `prefs.js` go through `_()` and must be translated in `po/ru.po`.
- Documentation exists in English (`README.md`) and Russian (`README.ru.md`); keep them in sync.

## Releases

When `shell-version` changes, re-check `offscreenBox()` in `extension.js` against Clutter (see
the comment there) and look at the rounded corners in a real session.

Bump the integer `version` in `metadata.json`, commit, push tag `v<version>`. CI checks that the
tag matches and attaches the archive to a GitHub release. Do not tag or push without being asked.
