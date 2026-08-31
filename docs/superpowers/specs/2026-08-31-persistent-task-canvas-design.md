# Museboard Persistent Task Canvas Design

Date: 2026-08-31  
Status: Approved in conversation

## Goal

Make Museboard a persistent visual workspace for a single Codex task. Each task can opt into exactly one canvas. The canvas retains its layout, generated images, History, Assets, and AgentRuns across closing and reopening. This change also adds first-class text-to-image generation, reliable chat-to-canvas collection, Chinese Skill labels, and removes the broken duplicate send-to-chat control.

## Product Rules

- A Codex task has zero or one Museboard canvas.
- A canvas is created only after the task first invokes Museboard.
- The task thread id maps deterministically to one canvas id.
- Returning to the task restores the same canvas. If the in-app browser tab was closed, invoking `@Museboard` reopens the existing canvas.
- Museboard does not offer multiple canvases within one task.
- Canvas files live under the task workspace, never under a temporary demo directory:

```text
<workspace>/canvas/threads/<canvasId>/
├─ codex-canvas.json
├─ assets.json
├─ assets/
├─ jobs/
└─ runs/
```

- The current test canvas for thread `01a048aa-e74e-7c80-9ceb-4b842e371f72` becomes that task's persistent canvas under `E:\codexwork\museboard\canvas\threads\<canvasId>\`.
- The source temporary canvas is retained as a backup until the migrated canvas is manually verified.
- The workspace already ignores `/canvas/` in Git, so generated assets remain local and are not accidentally committed.

## Canvas Lifecycle and Migration

Opening Museboard resolves the active workspace and thread id, derives the stable canvas id, and opens or creates the matching store. It must not create stores for unrelated tasks.

The current test-canvas migration copies the complete thread canvas directory, including state, assets, jobs, runs, and indexes. Migration must not overwrite an existing non-empty destination. After copying, Museboard verifies that the state JSON can be read, referenced asset files exist, and the expected object and asset counts match. The temporary source is not deleted automatically.

The persistent project registry and runtime metadata are updated to point at the workspace canvas. The URL may receive a new project id, but the thread id and logical canvas remain unchanged.

## Agent Modes and Text-to-Image

The Agent panel exposes an explicit mode so image relationships are never implicit:

- `New image`: no source images are sent to analysis or ImageGen.
- `Edit / use reference`: one to three selected canvas images are sent as sources.
- When images are selected, the user can choose `Ignore selected images` to run a clean text-to-image request without changing the canvas selection.

Add stable Skill id `generate-image` with Chinese display name `文生图`. It accepts zero source images and produces one image after explicit confirmation. Existing edit Skills retain their current source-image requirements and behavior.

`AgentRun.sourceObjectIds` becomes an array that may be empty. Zero-source runs may only select Skills compatible with zero sources. The analyzer receives an empty source list and may recommend `generate-image`; it must not recommend Quick Edit or another source-dependent Skill.

Confirming a `generate-image` run starts a dedicated backend generation action with no image attachments. The result is stored with generation provenance, no `sourceObjectId`, and is placed near the current visible canvas area. It appears in the canvas, History, and Assets.

## Chat-to-Canvas Collection

When a task has opened its persistent Museboard canvas, automatic collection is enabled for that task's generated-image directory. A new image generated from the Codex conversation is imported into the same task canvas and Assets as a chat-generated asset.

Collection is scoped to the bound thread id, deduplicates already imported paths, and excludes outputs already handled by Museboard jobs. Tasks that never enabled Museboard do not start collection. The current demo's `autoCollect: false` setting is not carried into the persistent canvas.

The acceptance flow includes one real conversation-generated image to verify that it appears automatically in the open canvas.

## Chat Toolbar

The automatic `send-to-chat` airplane button is removed. It currently starts another Codex app-server writer for the active task and fails with an active-writer conflict.

The existing `@file` button remains as the single chat handoff control. Its Chinese label is `复制到对话`. It copies the selected local image as an `@<absolute-path>` reference and shows `已复制图片引用，请回到对话粘贴。`

The frontend no longer calls `/api/chat-turn`. Unsupported automatic chat writing is not exposed in the UI. Server errors that remain user-actionable should return their real message instead of only `Internal server error`.

## Chinese Skill Display

Localization changes only the display layer. Stable Skill ids, backend actions, Skill files, and server-owned prompts remain unchanged.

| Stable id | Chinese display name |
|---|---|
| `generate-image` | 文生图 |
| `quick-edit` | 快速编辑 |
| `expand` | 扩图 |
| `remove-bg` | 移除背景 |
| `edit-text` | 编辑文字 |
| `edit-elements` | 编辑元素 |
| `xiaohongshu-cover` | 小红书封面 |
| `product-marketing-set` | 产品营销组图 |

Skill names, descriptions, brief-field labels, status messages, and History labels use the active UI language. English mode continues to show English labels.

## Error Handling

- A missing or invalid thread id prevents task-canvas creation and shows a clear binding error.
- Migration stops without overwriting when a destination already contains different canvas data.
- A zero-source run selecting a source-dependent Skill fails validation before generation.
- Automatic collection failures are logged without deleting generated files or existing canvas assets.
- Clipboard failure shows a direct copy-failed message and does not call the retired chat-turn route.

## Verification

Verification stays proportional to the behavior changed:

1. Targeted storage test for deterministic task-canvas reopening and safe migration.
2. Targeted AgentRun and API tests for zero-source analysis, confirmation idempotency, and a `generate-image` job.
3. Targeted collection test for thread scoping, deduplication, and Museboard-job exclusion.
4. UI check for explicit generation mode, Chinese Skill labels, removal of the airplane control, and the retained copy-to-chat action.
5. One real conversation-generation smoke test with automatic canvas import.
6. One full test-suite run before the implementation commit.

## Non-Goals

- Multiple canvases per Codex task.
- A project-wide canvas shared by unrelated tasks.
- tldraw, React Flow, nodes, edges, DAG workflows, SQLite, or a separate login/API key.
- OS-specific UI automation or simulated input into Codex.
- Recreating automatic send-to-chat before Codex exposes a stable supported host integration.
