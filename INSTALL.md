# Museboard 安装说明

仓库地址：https://github.com/joelam-byte/museboard-next.git

Museboard Next 基于 MIT 许可的 Codex-Canvas v0.3.1。安装新版本时使用 Museboard 的仓库、CLI 和 plugin 名称；已有画布数据与 `CODEX_CANVAS_*` 环境变量仍保持兼容。

## 让 Codex 自动安装

可以把下面这段作为安装任务发给 Codex：

```text
请根据 https://github.com/joelam-byte/museboard-next.git 里的 INSTALL.md 安装 Museboard。
安装完成后，新建一个 Codex 任务，再使用 @Museboard 打开画布。
```

安装流程是：把仓库 clone 到本机一个长期保留的目录，切换到最新稳定 Release 对应的本地分支，运行 personal marketplace 安装器，然后用 Codex CLI 安装这个 personal plugin。不要直接从 `main` 安装。

## 手动安装

下面使用 `~/src/museboard` 作为示例路径；它不是固定要求。

```bash
mkdir -p ~/src
git clone https://github.com/joelam-byte/museboard-next.git ~/src/museboard
cd ~/src/museboard
npm run checkout:stable
npm ci
npm run install:personal
codex plugin add museboard@personal
```

`npm run checkout:stable` 会从最新稳定的 `vX.Y.Z` tag 创建或更新本地 `museboard-stable` 分支。工作树最终必须精确停在 Release commit，因此不会把 `main` 上尚未发布的提交安装给普通用户。

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

Museboard 的稳定更新以 `vX.Y.Z` Git tag 和产物完整的 GitHub Release 为边界。Settings 会确认 Release 同时包含 plugin 包、`release-manifest.json` 和 `SHA256SUMS`，并验证 manifest commit 与 tag 一致。

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
