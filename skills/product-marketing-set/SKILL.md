---
name: product-marketing-set
description: "Create one confirmed fixed slot of a Museboard product-marketing image set."
---

# Museboard Product Marketing Set

Use this Skill only for a confirmed Museboard `product-marketing-set` job.

## Intent

Each invocation creates exactly one independently generated slot from a product marketing set: main image, benefit image, lifestyle scene, or detail image. Museboard starts the four slots as separate jobs so one failed slot can be retried without regenerating successful ones.

## Inputs

- One to three approved canvas product-reference images.
- A server-owned recipe containing sales channel, primary benefit, optional audience, visual style, preservation notes, the fixed output slot, and its 1080×1350 PNG requirement.

## Preservation

Keep product geometry, logo treatment, proportions, materials, and all elements explicitly marked in the recipe accurate across every output. Do not invent alternate product variants, false claims, watermarks, UI, or unrequested readable copy.

## Output

Call ImageGen exactly once for the assigned slot. Produce one 1080×1350 (4:5) PNG, not a collage, contact sheet, or multi-image layout. Follow the output-specific direction:

- Main: clear primary listing image.
- Benefit: credible visual explanation of the stated primary benefit.
- Scene: audience-appropriate lifestyle usage.
- Detail: accurate material, finish, or construction focus.

## Canvas placement

Save the result into the job output directory supplied by Museboard. Museboard collects it, records the AgentRun and all source references, and replaces the job placeholder beside the first selected source image.

Do not ask questions from this background job; the user has already confirmed the brief.
