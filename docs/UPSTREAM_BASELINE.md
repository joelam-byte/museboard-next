# Upstream baseline

Museboard Next starts from the unmodified Codex-Canvas v0.3.1 source tree and keeps its MIT license and attribution.

## Provenance

- Upstream repository: `https://github.com/Xiangyu-CAS/codex-canvas.git`
- Upstream release: `v0.3.1`
- Baseline commit: `126c7392245ec4714f3e71291b86f133d1b74e8c`
- Local provenance tag: `upstream-codex-canvas-v0.3.1`
- Museboard repository: `https://github.com/joelam-byte/museboard-next.git`

The `upstream` Git remote is retained for future read-only comparison and selective synchronization. Museboard changes are developed on feature branches and enter `main` through pull requests.

## Rename and compatibility boundary

The package, plugin manifest, CLI, MCP server, release artifacts, browser title, documentation, and user-facing messages use the Museboard name. Stable canvas action ids such as `quick-edit`, `remove-bg`, and `expand` are unchanged.

Existing project data remains readable. In particular, legacy `codex-canvas.json` state files, `.codex-canvas-runtime.json`, local storage keys, registry paths, and the documented `CODEX_CANVAS_*` environment variables remain compatibility interfaces rather than user-facing branding.

## Baseline verification

CI covers unit and smoke tests, plugin and Skill contracts, visual smoke checks on Linux, macOS, and Windows under Node.js 24, Windows screenshot regression, and release archive installation on all three operating systems. Node.js 18.18 and 22 compatibility checks remain in the matrix.
