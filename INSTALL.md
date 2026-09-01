# Museboard 安装说明

仓库地址：https://github.com/joelam-byte/museboard-next.git

Museboard 是为个人 Codex 工作流定制的本地插件。它基于 MIT 许可的 Codex-Canvas v0.3.1 开发，并保留原项目的 MIT 许可与来源说明；Museboard 在此基础上加入了长期任务画布、Agent 简报、Skill 面板、History、Assets 和业务图像生成能力。详情见 [`docs/UPSTREAM_BASELINE.md`](docs/UPSTREAM_BASELINE.md)。

## 当前可安装版本：main 开发/Alpha 版

当前尚未发布 Museboard stable Release。若要在自己的另一台电脑测试，请从 GitHub 的 `main` 分支安装。这是开发/Alpha 版：适合个人使用和验证，不是固定的正式发布包。

### 推荐方式：GitHub Desktop + Codex

1. 在目标电脑安装并登录 GitHub Desktop 与 Codex。
2. GitHub Desktop 选择 **File → Clone repository → URL**，粘贴：

   ```text
   https://github.com/joelam-byte/museboard-next.git
   ```

3. 选择一个普通本地目录完成 Clone，例如 `D:\Codex Projects\museboard`。
4. 在 Codex 新建本地任务，并选择刚克隆的 `museboard` 文件夹。
5. 将下面内容发送给 Codex：

   ```text
   请在当前 Museboard 项目中安装本地开发版插件。

   请依次完成：
   1. 安装项目依赖。
   2. 运行 npm run install:personal。
   3. 运行 codex plugin add museboard@personal。

   不要修改代码、不要创建提交、不要上传 GitHub。完成后告诉我安装结果。
   ```

6. 安装完成后，新建一个 Codex 任务，再输入：

   ```text
   @Museboard 打开画布
   ```

### 手动方式

下面命令可在 Windows PowerShell、macOS 或 Linux 终端逐行执行：

```bash
git clone https://github.com/joelam-byte/museboard-next.git museboard
cd museboard
npm ci
npm run install:personal
codex plugin add museboard@personal
```

安装后必须新建一个 Codex 任务，让新版 Skills 和 MCP server 从新缓存加载。

### 更新开发/Alpha 版

在 GitHub Desktop 对该仓库执行 **Fetch origin → Pull origin**。然后在该仓库目录重新执行：

```bash
npm ci
npm run install:personal
codex plugin add museboard@personal
```

最后关闭旧画布并新建 Codex 任务。仅刷新画布网页不能重载 Skills 和 MCP server。

## 首次正式 Release 发布后

首个正式 Museboard Release 将是 `v0.4.0`。当 GitHub 出现带有插件包、`release-manifest.json` 与 `SHA256SUMS` 的正式 Release 后，普通安装改用：

```bash
git clone https://github.com/joelam-byte/museboard-next.git museboard
cd museboard
npm run checkout:stable
npm ci
npm run install:personal
codex plugin add museboard@personal
```

`npm run checkout:stable` 只接受 Museboard 自己的、产物完整且 manifest 与 tag 一致的正式 Release。不要使用上游 Codex-Canvas 的 `v0.3.1` tag，也不要把上游来源 tag 当成 Museboard Release。

`npm run install:personal` 会创建或更新 `~/plugins/museboard`，并把 Museboard 条目写入 `~/.agents/plugins/marketplace.json`。它还会 best-effort 安装 `rapidocr_onnxruntime`，用于 Edit Text 本地 OCR；失败时 plugin 仍会完成安装，并回退到 Codex 视觉识别。

若要跳过 RapidOCR 安装：

```bash
CODEX_CANVAS_SKIP_OCR_INSTALL=1 npm run install:personal
```

或：

```bash
npm run install:personal -- --skip-ocr
```

安装后新建一个 Codex 任务，再使用 `@Museboard` 打开画布，让新版 skills 和 MCP server 从新缓存加载。也可以尝试 `/canvas`、`$canvas` 或直接说“打开 Museboard 画布”。

## 更新

Museboard 的稳定更新以 `vX.Y.Z` Git tag 和产物完整的 GitHub Release 为边界。Settings 会确认 Release 同时包含插件包、`release-manifest.json` 和 `SHA256SUMS`，并验证 manifest commit 与 tag 一致。

- 打开画布时只检查新 Release，不会静默修改本地代码。
- **Settings → Version** 会安全 fast-forward 到最新稳定 tag、安装锁定依赖，并重新执行 `codex plugin add museboard@personal`。
- 更新完成后必须关闭旧画布并新建 Codex 任务；仅刷新网页不能重载 MCP server 和 skills。
- 源码有未提交修改、本地提交、分支分叉，或 Release tag 与 manifest 不一致时，自动更新会停止，不会覆盖本地工作。

也可以通过 CLI 检查或安装：

```bash
node ./bin/museboard.mjs update --check
node ./bin/museboard.mjs update
```

## 可选依赖

本地 OCR、Edit Elements 拆层和背景处理不是打开画布的硬性前置条件：

```bash
npm run setup:deps
npm run doctor:deps
```

也可分别运行：

```bash
npm run doctor:ocr
npm run setup:ocr
npm run doctor:image-deps
npm run setup:image-deps
```

## 安装器行为

`npm run install:personal` 写入的 plugin 条目形如：

```json
{
  "name": "museboard",
  "source": {
    "source": "local",
    "path": "./plugins/museboard"
  },
  "policy": {
    "installation": "AVAILABLE",
    "authentication": "ON_INSTALL"
  },
  "category": "Productivity"
}
```

安装器只会创建或更新指向当前仓库的 symlink/junction；如果 `~/plugins/museboard` 已是普通文件或目录，命令会拒绝覆盖。

测试或临时安装可以设置：

```bash
CODEX_CANVAS_PERSONAL_HOME=/path/to/home npm run install:personal
```

这样会写入该目录下的 `plugins/museboard` 和 `.agents/plugins/marketplace.json`，不影响真实用户目录。
