# M0 AI Asset Gate / Asset Feasibility v0.1

This experiment answers one question: can reference-conditioned AI production create consistent Whole-body PoseClip assets that pass deterministic QA and enter the frozen Paper Engine/Pixi Renderer without core changes?

The experiment owns its Manifest, Anchor, QA, and review contracts. They are not formal RenderPlan schemas yet.

## Asset flow

```text
Character Reference
→ Generated chroma-key source
→ Matting / Alpha PNG
→ Anchor metadata
→ Automated QA
→ PoseClip Preview
→ Experiment RenderPlan importer
→ Frozen Paper Engine / paper-pixi
→ 10-second AI Demo
```

## Commands

```powershell
pnpm --filter @pose-clip/asset-feasibility check
pnpm --filter @pose-clip/asset-feasibility test
pnpm --filter @pose-clip/asset-feasibility qa
pnpm --filter @pose-clip/asset-feasibility dev
pnpm --filter @pose-clip/asset-feasibility demo
```

The web lab serves two pages: `/` is the Anchor Editor/PoseClip Preview and `/demo.html` is the canonical 1280×720 renderer integration. The demo exports 300 PNG frames and `output/asset-gate-10s.mp4` through the accepted PixiJS → PNG → FFmpeg path.

Generated bitmap sources, processed PNGs, reports and demo output are local experiment artifacts and are Git-ignored. Prompts, manifests, anchor metadata, QA tools, contract tests and the final Gate report remain reviewable source.

## Gate

The Gate is PASS only after Farmer 8+ states, Walk/Run clips, Rabbit package, four environment layers, matting, anchors, automated QA, frozen-renderer integration, and the 10-second AI demo all pass. Code completion alone is not a PASS.

Current decision: **PASS / Asset pipeline feasible**, with the known quality debt that auto-estimated anchors require human approval before production and real AI Run frames need canvas/body normalization to reduce GroundLock compensation.
