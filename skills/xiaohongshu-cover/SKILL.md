---
name: xiaohongshu-cover
description: "Create one confirmed 3:4 Xiaohongshu cover from one to three Museboard reference images."
---

# Museboard Xiaohongshu Cover

Use this Skill only for a confirmed Museboard `xiaohongshu-cover` job.

## Intent

Create one finished Chinese Xiaohongshu social cover, rather than a draft, collage, or set of variants.

## Inputs

- One to three approved canvas source images, in the order supplied by Museboard.
- A server-owned recipe containing content type, the exact Chinese headline, headline style, headline position, preservation notes, and the 1080×1440 PNG output requirement.

## Preservation

Preserve the identity of referenced products, brands, logos, proportions, materials, and all elements explicitly listed in the recipe. Do not add unrequested readable text, watermarks, UI, or source-image annotations.

## Output

Call ImageGen exactly once and produce one 1080×1440 (3:4) PNG. Render the provided headline exactly once in the stated style and position. Do not create variants or extra panels.

## Canvas placement

Save the result into the job output directory supplied by Museboard. Museboard collects it, keeps its source-object and AgentRun provenance, and replaces the job placeholder adjacent to the first selected source image.

Do not ask questions from this background job; the user has already confirmed the brief.
