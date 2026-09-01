# Museboard

[中文](README.md) | [English](README.en.md)

Museboard is an infinite canvas plugin for Codex. It requires no API setup and uses Codex's built-in GPT-image-2 workflow to edit images on a local canvas. It opens directly inside Codex, collects generated images into the current project, and lets you organize, annotate, edit, compare, and reuse visual assets.

Museboard Next is based on MIT-licensed [Codex-Canvas v0.3.1](https://github.com/Xiangyu-CAS/codex-canvas/releases/tag/v0.3.1), and preserves its MIT license and provenance. Museboard adds persistent task canvases, Agent briefs, a Skill panel, History, Assets, and business image-generation workflows for a personal design process. See [`docs/UPSTREAM_BASELINE.md`](docs/UPSTREAM_BASELINE.md) for provenance and compatibility details.

It brings a Lovart-like workflow to Codex: chat on one side, canvas on the other, with powerful image editing tools designed around the same creative loop.

<p align="center">
  <img src="assets/readme/overview.webp" alt="Open Codex Canvas" width="760">
</p>

## Installation

Copy this prompt into Codex:

```text
Install the Museboard local development build according to INSTALL.md in this project.
Do not modify code, create commits, or push to GitHub.
After installation, start a new Codex task and type `@Museboard open the canvas`.
```

See the full installation guide in [`INSTALL.md`](INSTALL.md).

Museboard does not have a stable Release yet. For personal testing, install the development/Alpha build from GitHub `main`; switch to the stable path after the official `v0.4.0` Release. **Settings → Version** only installs a complete, manifest-matched `vX.Y.Z` release, never unreleased commits from `main`. The old server exits after an update; reopen the canvas and start a new Codex task.

After installation, start a new Codex task and open the canvas:

```text
@Museboard open the canvas
```

## Roadmap

- [x] GPT-image-2 powered image editing
- [ ] Editable PPT generation and export
- [ ] draw.io flowchart generation and editing

## Highlights

### 1. Open a canvas and collect generated images automatically

Type `@Museboard open the canvas` in your current Codex conversation, and Museboard opens a local project canvas in the in-app browser. Keep chatting on the left while managing visual assets on the right. Once bound, Museboard collects only that thread's outputs from `~/.codex/generated_images/<thread-id>`; it does not scan other projects, other threads, or the whole project directory. Results are persisted into that thread's canvas.

<p align="center">
  <img src="assets/readme/auto-collect.webp" alt="Auto collect generated images" width="640">
</p>

### 2. Quick Edit: mark what you want changed

Quick Edit now defaults to an arrow-note tool: drag from a note position outside the image to the region you want changed, then type the instruction inline. Brush masks, colors, standalone text, and an optional overall prompt remain available. The source and annotations stay in place while the running placeholder and final revision remain on the canvas to the right.

<p align="center">
  <img src="assets/readme/quick-edit-comparison.webp" alt="Quick Edit comparison" width="700">
</p>

### 3. Edit Elements: separate layers and rearrange them

Edit Elements separates an image into movable layers such as background, text, products, people, and price tags. You can rearrange those layers on the canvas, while Museboard can continue completing the background that was hidden behind foreground objects. Downloading any layer from an Edit Elements group exports the whole group as a PSD, with each canvas layer mapped to a Photoshop layer for further editing in tools like Photoshop or Photopea.

<p align="center">
  <img src="assets/readme/edit-elements-comparison.webp" alt="Edit Elements comparison" width="700">
</p>

### 4. Edit Text: recognize and rewrite text in images

Edit Text recognizes text in the image and lists it as editable fields. You can revise individual lines while asking the model to preserve the original typography, layout relationships, and visual tone.

<p align="center">
  <img src="assets/readme/edit-text-comparison.webp" alt="Edit Text comparison" width="700">
</p>

### 5. Remove BG: remove backgrounds in one step

For posters, portraits, product shots, and other assets, Museboard can create a transparent-background result directly on the canvas. The result stays in the same project canvas, ready for composition, layout, or reuse in Codex.

<p align="center">
  <img src="assets/readme/remove-bg-result.webp" alt="Remove BG result" width="560">
</p>

### 6. Expand: outpaint to a new aspect ratio

Expand provides a visual expansion frame and common aspect-ratio presets such as 1:1, 3:4, 16:9, and 9:16. Choose the target canvas first, then let the model complete the surrounding image content.

<p align="center">
  <img src="assets/readme/expand-comparison.webp" alt="Expand comparison" width="700">
</p>

## Features

- Opens a local infinite canvas in Codex's in-app browser.
- Automatically collects Codex/ImageGen outputs into the bound thread canvas without leaking outputs from other projects or conversations.
- Supports uploading, importing, arranging, selecting, dragging, deleting, and downloading canvas images.
- Supports explicitly linked arrow notes, brush annotations, and temporary text labels, including notes outside the image.
- Supports Quick Edit without an overall prompt, sending a clean source, annotation board, and structured annotation details to the model.
- Supports background removal.
- Supports Expand/outpaint with an adjustable expansion preview frame.
- Supports Edit Text; local OCR is used first when available, with Codex vision fallback when needed.
- Supports Edit Elements, separating images into foreground object/text layers and a background layer.
- Supports background completion for Edit Elements and replaces the background layer in place.
- Supports downloading Edit Elements layer groups as PSD files, with each canvas layer mapped to a Photoshop layer.
- Keeps one persistent canvas for each Codex conversation and restores it after reopening.
- Supports a zero-reference New image mode as well as one to three reference images for edit analysis.
- Uses an Agent to prepare a structured brief, recommend a Skill, and ask only result-significant clarifications; generation always needs explicit confirmation.
- Supports a Skill panel, History, Assets, version relationships, and reinserting an asset after it has been removed from the canvas.
- Includes Xiaohongshu Cover and Product Marketing Set Skills.
- Supports copying a selected image as an `@file` reference and pasting it back into Codex chat.

## Usage Notes

Museboard stores canvas data in the current project's `canvas/` directory. Generated assets, job logs, and intermediate files stay local to the project.

Copy to chat copies the selected image's `@file` reference. Paste it into the Codex chat box to use the image as a reference in a follow-up request.

## Development

Common local commands:

```bash
npm install
npm test
node ./bin/museboard.mjs open --project .
```

Related docs:

- [`INSTALL.md`](INSTALL.md): installation guide and optional local dependencies.
- [`docs/RELEASING.md`](docs/RELEASING.md): versioning, Release PR, tag, and artifact workflow.
- [`docs/CANVAS_TO_CHAT.md`](docs/CANVAS_TO_CHAT.md): current canvas-to-chat validation results and limitations.

## Provenance and credits

- Museboard Next is based on [Xiangyu-CAS/Codex-Canvas](https://github.com/Xiangyu-CAS/codex-canvas) v0.3.1 and preserves its MIT license and provenance.
- Thanks to [Cowart](https://github.com/zhongerxin/Cowart) for the canvas interaction concept.
