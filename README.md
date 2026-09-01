# Museboard

[中文](README.md) | [English](README.en.md)

Museboard 是一个面向 Codex 的无限画布 Plugin，无需配置 API，调用 Codex 内置 GPT-image-2 实现画布编辑功能。它可以在 Codex 里打开画布，把生成的图片收录到当前项目中，并让你继续整理、标注、编辑、比较这些视觉资产。

Museboard Next 基于 MIT 许可的 [Codex-Canvas v0.3.1](https://github.com/Xiangyu-CAS/codex-canvas/releases/tag/v0.3.1) 建立，并保留其 MIT 许可与来源说明。Museboard 按个人设计工作流加入了长期任务画布、Agent 简报、Skill 面板、History、Assets 和业务图像生成能力；基线与后续差异见 [`docs/UPSTREAM_BASELINE.md`](docs/UPSTREAM_BASELINE.md)。

这个插件把 Codex 变成更接近 Lovart 的工作形态：一边对话，一边画布，并参照 Lovart 画布提供许多强大的编辑功能。

<p align="center">
  <img src="assets/readme/overview.webp" alt="Open Codex Canvas" width="760">
</p>

## 安装

把下面这段复制给 Codex：

```text
请根据当前项目的 INSTALL.md 安装 Museboard 本地开发版。
不要修改代码、不要创建提交、不要上传 GitHub。
安装完成后，新建 Codex 任务，再输入：`@Museboard 打开画布`。
```

完整安装说明见 [`INSTALL.md`](INSTALL.md)。

当前尚无 Museboard stable Release。个人测试请从 GitHub `main` 安装开发/Alpha 版；正式 `v0.4.0` Release 发布后再改用稳定安装流程。画布中的 **Settings → Version** 只安装产物完整、manifest 与 tag 一致的正式 `vX.Y.Z`，不会跟随 `main` 上的未发布提交。更新后旧 server 会退出，需要重新打开画布并新建 Codex 任务。

安装完成后，新建一个 Codex 任务并打开画布：

```text
@Museboard 打开画布
```

## Roadmap

- [x] GPT-image-2 图片编辑
- [ ] 可编辑 PPT 生成与导出
- [ ] draw.io 流程图生成与编辑

## 特色功能

### 1. 打开画布并自动收录生成图片

在当前 Codex 对话里输入 `@Museboard 打开画布`，Museboard 会在 in-app browser 中打开项目本地画布。左侧继续对话，右侧管理视觉资产。绑定 thread 后，Museboard 只会收录该 thread 在 `~/.codex/generated_images/<thread-id>` 下的生成图片，不会扫描其他项目、其他 thread 或整个项目目录；生成结果会持久化到当前 thread 的画布中。

<p align="center">
  <img src="assets/readme/auto-collect.webp" alt="自动收录生成图片" width="640">
</p>

### 2. Quick Edit：用标注告诉模型怎么改

选中图片后可以直接进入 Quick Edit。默认的箭头批注工具支持从图片外拖向修改区域，松手后就地输入要求；也可以继续使用画笔圈选、颜色、独立文字和可选的总说明。原图与标注会保留，运行中的占位图和最终新图都继续显示在画布右侧。

例如，可以把“加一个太阳”和“加一个月亮”分别写在图片外，再用箭头指向对应的修改区域。Quick Edit 会把每条标记作为独立的修改要求，并在右侧保留生成结果方便对照。

<p align="center">
  <img src="assets/readme/quick-edit-arrow.png" alt="使用箭头和文字标记 Quick Edit 修改内容" width="700">
</p>

<p align="center">
  <img src="assets/readme/quick-edit-comparison.webp" alt="Quick Edit comparison" width="700">
</p>

### 3. Edit Elements：拆出元素继续重排

Edit Elements 可以把图片拆成背景、文字、商品、人物、价格标签等可移动图层。拆分后可以在画布上重排素材，也可以让后台继续补全被前景遮挡的背景层。下载任意一个拆分图层时，Museboard 会把同组图层一起导出为 PSD，方便继续交给 Photoshop、Photopea 等专业工具精修。

<p align="center">
  <img src="assets/readme/edit-elements-comparison.webp" alt="Edit Elements comparison" width="700">
</p>

### 4. Edit Text：识别并改写图片文字

Edit Text 会先识别图片里的文字，再把可编辑文本列出来。你可以逐行修改文案，并让模型尽量保持原有字体风格、版式关系和视觉氛围。

<p align="center">
  <img src="assets/readme/edit-text-comparison.webp" alt="Edit Text comparison" width="700">
</p>

### 5. Remove BG：一键去背景

对于海报、人像、商品图等素材，可以直接在画布中生成透明背景结果，并与原图并排比较。去背景后的结果仍然保留在同一个项目画布里，方便继续组合、排版或发送回 Codex 使用。

<p align="center">
  <img src="assets/readme/remove-bg-result.webp" alt="Remove BG result" width="560">
</p>

### 6. Expand：按比例扩图和补全画面

Expand 支持可视化扩图框和常用比例预设，例如 1:1、3:4、16:9、9:16 等。你可以先决定新画幅，再让模型补全边缘内容，适合把竖版海报改成横版、方图或其他投放尺寸。

<p align="center">
  <img src="assets/readme/expand-comparison.webp" alt="Expand comparison" width="700">
</p>

## 功能

- 在 Codex 的 in-app browser 中打开本地无限画布。
- 按绑定 thread 自动收录 Codex/ImageGen 生成的图片，隔离其他项目和对话。
- 支持上传、导入、排列、选择、拖动、删除和下载画布图片。
- 支持与图片显式关联的箭头批注、画笔标注和临时文字标注，说明可以放在图片外。
- 支持无总 Prompt 的 Quick Edit，并把干净原图、标注说明图和结构化标注要求一起传给模型。
- 支持图片去背景。
- 支持 Expand/outpaint，并提供可调整的扩图预览框。
- 支持 Edit Text；本地 OCR 可用时优先使用本地识别，不可用时回退到 Codex 视觉识别。
- 支持 Edit Elements，把图片拆成前景物体/文字图层和背景图层。
- 支持后台补全 Edit Elements 背景，并原位替换背景层。
- 支持将 Edit Elements 图层组下载为 PSD，每个画布图层对应一个 Photoshop 图层。
- 每个 Codex 对话对应一张长期画布，关闭后重新打开可恢复原有状态。
- 支持不选参考图的“新建图片”模式，也支持一至三张参考图的改图分析。
- Agent 会生成结构化简报、推荐 Skill，并只在确实影响结果时提出澄清问题；生成前必须确认。
- 支持 Skill 面板、History、Assets、版本关系和移出画布后重新插入资产。
- 支持小红书封面与产品营销组图 Skill。
- 支持复制选中图片的 `@file` 引用，粘贴到 Codex 聊天框中继续使用。

## 使用说明

Museboard 会把画布数据保存在当前项目的 `canvas/` 目录下。生成资产、任务日志和中间文件都会留在本地项目中。

画布中的“复制到对话”会复制图片的 `@file` 引用。回到 Codex 聊天框粘贴即可把图片作为后续需求的参考图。

## 开发

常用本地命令：

```bash
npm install
npm test
node ./bin/museboard.mjs open --project .
```

相关文档：

- [`INSTALL.md`](INSTALL.md)：安装说明和可选本地依赖。
- [`docs/RELEASING.md`](docs/RELEASING.md)：版本号、Release PR、tag 和发布产物流程。
- [`docs/CANVAS_TO_CHAT.md`](docs/CANVAS_TO_CHAT.md)：当前 canvas-to-chat 的验证结果和限制。

## 来源与致谢

- Museboard Next 基于 [Xiangyu-CAS/Codex-Canvas](https://github.com/Xiangyu-CAS/codex-canvas) v0.3.1，遵循并保留 MIT 许可与来源说明。
- 感谢 [Cowart](https://github.com/zhongerxin/Cowart) 提供的画布交互思路。
