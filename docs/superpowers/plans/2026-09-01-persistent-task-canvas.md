# Museboard 单任务长期画布实施计划

> **执行说明：** 按任务逐项实施；每项完成后只运行与该功能直接相关的验证，最终本地提交前再运行一次完整测试。

**目标：** 让每个启用 Museboard 的 Codex 任务拥有一张可恢复的长期画布，并支持无参考图文生图、任务内图片自动导入和完整中文操作界面。

**架构：** 沿用现有 `threadId → canvasId`、本地 `canvas/threads/<canvasId>/` 存储、AgentRun 和图片 job 体系。新增的长期画布迁移在服务注册任务时执行；文生图作为零来源 Skill 进入同一套 AgentRun 确认流程；前端只发送稳定 Skill ID，具体提示词和图片任务逻辑仍由后端负责。

**技术栈：** Node.js ESM、原生 DOM 前端、Codex Plugin/MCP、本地文件存储、Codex 内置 ImageGen。

**设计依据：** `docs/superpowers/specs/2026-08-31-persistent-task-canvas-design.md`

## 全局约束

- 一个 Codex 任务最多一张长期主画布；第一次 `@Museboard` 才创建。
- 数据保存于 `<workspace>/canvas/threads/<canvasId>/`；不使用 SQLite、tldraw、React Flow、节点、连线或 DAG。
- 保持 Windows 与 macOS 兼容；不使用系统专用 UI 自动化。
- 画布 AI 操作使用稳定 Skill ID，提示词和保留规则放在后端。
- 每次图片生成仍需用户明确确认；重复确认不得重复创建 job。
- 不触碰旧 Museboard 仓库；不执行 GitHub 推送、PR、Issue、tag 或 Release 操作。

---

## 文件与职责

| 文件 | 本次职责 |
| --- | --- |
| `src/runtime.mjs` | 维护 `threadId → canvasId` 的稳定映射，并提供迁移所需的线程 ID 规范化。 |
| `src/paths.mjs` | 继续作为 `canvas/threads/<canvasId>/`、assets、jobs、runs 的唯一目录定义。 |
| `src/legacy-canvas-migration.mjs`（新增） | 安全复制旧临时测试画布；只迁移到空目标，不覆盖冲突数据。 |
| `src/server.mjs` | 注册任务时执行迁移；使用绑定线程的自动收集；确认零来源文生图。 |
| `src/agent-run-contracts.mjs` | 注册 `generate-image`，并允许 AgentRun 的来源图片数量为零至三。 |
| `src/agent-brief-service.mjs`、`src/agent-analyzer.mjs` | 让没有来源图片的请求也能得到有效 Structured Brief 和 Skill 推荐。 |
| `src/agent-run-execution.mjs`、`src/jobs.mjs` | 创建、记录、收集和摆放零来源文生图 job。 |
| `public/index.html`、`public/app.js`、`public/styles.css` | 添加“新建图片 / 编辑或参考生成”模式；移除小飞机；完成中文显示。 |
| `test/task-canvas-persistence.test.mjs`（新增） | 验证线程绑定、恢复和安全迁移。 |
| `test/agent-run-api.test.mjs`、`test/agent-brief-service.test.mjs`、`test/agent-run-execution.test.mjs` | 验证零来源 AgentRun、确认幂等和来源约束。 |
| `scripts/smoke.mjs`、`scripts/visual-smoke.mjs` | 增加自动收集、中文 UI、无来源文生图和移除小飞机的可见验证。 |

## 任务 1：长期任务画布与旧测试数据迁移

**文件：**

- 新建：`src/legacy-canvas-migration.mjs`
- 修改：`src/server.mjs`、`src/runtime.mjs`
- 新建：`test/task-canvas-persistence.test.mjs`

**接口：**

```js
export async function migrateLegacyTaskCanvas({
  projectDir,
  threadId,
  canvasId,
  legacyRoot
})
// 返回 { migrated: boolean, sourceDir: string | null, destinationDir: string, conflict: string | null }
```

- [ ] 为 `migrateLegacyTaskCanvas` 写三个用例：空目标可迁移、非空且不同目标拒绝覆盖、重复打开不重复复制。
- [ ] 运行：`node --test test/task-canvas-persistence.test.mjs`；预期先因模块不存在失败。
- [ ] 在 `src/legacy-canvas-migration.mjs` 使用 `fs.cp(..., { recursive: true, errorOnExist: true })` 将旧目录复制到 `canvasDataDirFor(projectDir, canvasId)`；复制前比较目标是否为空，绝不删除或覆盖旧目录。
- [ ] 默认旧来源定位为 `os.tmpdir()/museboard-local-e2e-demo/canvas/threads/<threadId>`；允许 `MUSEBOARD_LEGACY_CANVAS_ROOT` 覆盖，方便恢复其他机器上的旧测试数据。
- [ ] 在 `src/server.mjs` 的 `registerProject` 中，取得规范化 `threadId` 和 `canvasId` 后、`ensureProjectStore` 前调用迁移；无 `threadId` 时跳过迁移。
- [ ] 保持现有 `canvasIdForThread(threadId)` 的哈希映射不变；`registerProject` 仍然是唯一绑定入口，因此同一任务不会产生第二张画布。
- [ ] 再运行：`node --test test/task-canvas-persistence.test.mjs`；预期通过。

## 任务 2：零来源“文生图”进入 AgentRun

**文件：**

- 修改：`src/agent-run-contracts.mjs`、`src/agent-brief-service.mjs`、`src/agent-analyzer.mjs`
- 修改：`src/agent-run-execution.mjs`、`src/jobs.mjs`、`src/server.mjs`
- 修改：`test/agent-brief-service.test.mjs`、`test/agent-run-api.test.mjs`、`test/agent-run-execution.test.mjs`

**接口：**

```js
// 新的稳定 SkillDescriptor
skillDescriptor("generate-image", "Generate Image", "Create a new image from a confirmed request.", 0, 0, 1, 1, {
  category: "generation",
  backendAction: "generate-image"
})

export async function createGenerationJob(projectDir, {
  action: "generate-image",
  prompt,
  agentRunId
}, { canvasId, viewport })
```

- [ ] 为 contracts 添加用例：`sourceObjectIds: []` 仅能配合 `generate-image`；`quick-edit` 与空来源在确认前被拒绝。
- [ ] 运行相关 contract/brief 用例；预期当前实现会因 `min: 1` 失败。
- [ ] 在 `SKILL_IDS` 和 `SKILL_DESCRIPTORS` 增加 `generate-image`；来源范围设为 0–0、输出范围设为 1–1、仍要求确认。
- [ ] 将 `validateAgentRun` 的通用来源数组范围改为 0–3；由 `validateSkillCompatibility` 负责判断各 Skill 的真实来源要求。
- [ ] 保持 `buildAnalysisContext` 对空来源返回 `sources: []`；在分析提示中明确说明零来源时只能推荐 `generate-image`，不能虚构参考图或保留规则。
- [ ] 在 `src/jobs.mjs` 新增独立的 `createGenerationJob`，不调用 `requireImageObject`，创建无 `sourceObjectId` 的占位图和本地 job；收集后写入 `assetKind: "generation"`、`agentRunId`、`jobId` 与空 `sourceObjectIds`。
- [ ] 使用现有 `startCodexImageJob` 调用 Codex ImageGen，但给零来源 job 传入空图片输入；让 job 的完成、失败、History 与 Assets 仍走现有 AgentRun 记录路径。
- [ ] 在 `confirmAgentRun` 中优先分发 `selectedSkillId === "generate-image"` 到 `createGenerationJob`；复用运行状态检查，重复 confirm 返回已存在 job 而不创建第二个。
- [ ] 将新图片的占位位置按当前视口中心计算；不要与来源图并排，因为文生图没有来源图。
- [ ] 运行三个针对性测试文件；预期确认前不产生 ImageGen job，确认后只产生一个 `generate-image` job。

## 任务 3：Agent 面板两种模式与中文显示

**文件：**

- 修改：`public/index.html`、`public/app.js`、`public/styles.css`
- 修改：`scripts/visual-smoke.mjs`

**界面状态：**

```js
let agentInputMode = "edit"; // "new" | "edit"

function effectiveAgentSources() {
  return agentInputMode === "new" ? [] : selectedAgentSources();
}
```

- [ ] 在 Agent 面板加入两个明确选择：`新建图片` 与 `编辑 / 参考生成`；默认依据是否选择图片决定，但用户可以手动切换。
- [ ] 新建图片模式下禁用来源检查，提交 `sourceObjectIds: []`，并显示“将忽略当前选中的图片”。
- [ ] 编辑 / 参考生成模式下保留现有 1–3 张图限制；没有图片时显示“请选择参考图，或切换到文生图”。
- [ ] 更新 `agentConfirmUnavailableReason`：`generate-image` 仅允许零来源；原有编辑 Skill 仍只允许其既有来源数量。
- [ ] 更新 `trackAgentImageJobs`：没有来源图时不调用 `frameJobPlacement`，而是保留后端的视口中心占位位置。
- [ ] 在中英文资源里增加 `generate-image: 文生图 / Generate Image`，以及模式说明、来源提示、确认状态和错误文字。
- [ ] 让 `skillName`、Skill 列表、Structured Brief、History、Assets 和状态标签在中文模式下显示中文；内部 ID、API 数据和后端提示词不变。
- [ ] 使用现有成熟 SVG 图标风格，不手绘新图标。
- [ ] 运行：`node scripts/visual-smoke.mjs`；验证不选图时“文生图”可分析、中文 Skill 名称正确、编辑模式仍显示来源限制。

## 任务 4：自动导入与“复制到对话”收口

**文件：**

- 修改：`src/server.mjs`、`src/collector.mjs`（仅在现有去重不足时）
- 修改：`public/index.html`、`public/app.js`、`public/styles.css`
- 修改：`scripts/smoke.mjs`、`scripts/visual-smoke.mjs`

**接口与规则：**

```text
自动导入目录：<generatedImagesRoot>/<threadId>/
排除目录：当前 Museboard image job 已登记的输出路径
复制内容：@<图片绝对路径>
```

- [ ] 为自动收集写用例：只扫描绑定 `threadId` 的目录；重复扫描不产生第二张图；Museboard 自己的 job 输出被 `excludePaths` 排除。
- [ ] 保持 `registerProject(..., { autoCollect: true, chatThreadId })` 的默认值；对持久注册的任务不再因旧测试设置 `autoCollect: false` 而失去自动导入能力。
- [ ] 保持 `autoCollectorWatchRoots` 只返回 `generatedImagesDirForThread(project.chatThreadId)`，不扫描其它任务或整个 generated_images 根目录。
- [ ] 为自动导入写入来源标记 `assetKind: "conversation-generation"`，并在 Assets/History 显示“对话生成”；保留原文件，收集失败只报告错误。
- [ ] 从 `public/index.html` 删除 `data-action="send-to-chat"` 小飞机按钮，并移除对应的 CSS 网格定位。
- [ ] 从 `public/app.js` 删除 `sendSelectedImageToChat`、点击分支和 `send-to-chat` 动作标签；前端不再请求 `/api/chat-turn`。
- [ ] 将 `copy-file-mention` 中文显示改为“复制到对话”，成功提示改为“已复制图片引用，请回到对话粘贴。”；失败时显示可复制绝对路径和真实失败原因。
- [ ] 运行 `node scripts/smoke.mjs` 中新增的自动收集断言，以及 `node scripts/visual-smoke.mjs` 中的工具栏断言；预期没有小飞机按钮，保留“复制到对话”。

## 任务 5：真实闭环、兼容性检查与本地提交

**文件：**

- 修改：仅在验证发现问题时修改对应实现。
- 修改：`docs/superpowers/specs/2026-08-31-persistent-task-canvas-design.md`，仅在实现与确认设计发生必要差异时记录。

- [ ] 在当前 Codex 任务中打开 Museboard，确认同一任务再次打开恢复同一主画布。
- [ ] 在不选择图片的情况下输入提示词：分析 → 查看中文简报 → 确认 → 新图片进入画布、History、Assets。
- [ ] 在任务对话中真实生成一张图片，确认它只自动进入这个任务的画布和 Assets。
- [ ] 选中原有图片，确认快速编辑、扩图、移除背景、编辑文字、编辑元素仍可进入原有流程。
- [ ] 选中图片后使用“新建图片”，确认该图片没有作为来源写入新 AgentRun。
- [ ] 运行一次完整测试：`npm test`；只在最终提交前运行一次。
- [ ] 检查：`git diff --check` 和 `git status --short`。
- [ ] 本地提交：`git add ...` 后使用 Conventional Commit，例如 `feat: add persistent task canvas generation flow`；不推送 GitHub。

## 覆盖检查

- 单任务一画布、恢复、旧测试迁移：任务 1。
- 不选图也可分析并生成：任务 2 与任务 3。
- 生成前确认、Skill 约束、重复确认幂等：任务 2。
- 当前任务对话图片自动导入、去重、排除自有输出：任务 4。
- 删除小飞机、保留可靠 `@文件` 引用复制：任务 4。
- 全中文界面显示、英文模式保持可用：任务 3。
- 真实使用闭环与完整测试：任务 5。

本计划不引入额外数据库、独立登录、云端同步、多画布、DAG 或系统专用自动化。
