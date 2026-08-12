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
pnpm --filter @pose-clip/asset-feasibility package
pnpm --filter @pose-clip/asset-feasibility dev
pnpm --filter @pose-clip/asset-feasibility demo
```

The web lab serves two pages: `/` is the Anchor Editor/PoseClip Preview and `/demo.html` is the canonical 1280×720 renderer integration. The demo exports 300 PNG frames and `output/m1-high-quality-demo-10s.mp4` through the accepted PixiJS → PNG → FFmpeg path.

Generated bitmap sources, processed PNGs, reports and demo output are local experiment artifacts and are Git-ignored. Prompts, manifests, anchor metadata, QA tools, contract tests and the final Gate report remain reviewable source.

## Gate

The Gate is PASS only after Farmer 8+ states, Walk/Run clips, Rabbit package, four environment layers, matting, anchors, automated QA, frozen-renderer integration, and the 10-second AI demo all pass. Code completion alone is not a PASS.

Current decision: **Feasibility PASS / not Production-ready**. Automated Structural QA is separate from Human Visual Review. The compiled asset package reports `productionReady=false` until anchor review and continuity warnings are closed.

M1 adds policy-driven whole-sprite normalization (translate + uniform scale only), character-scoped anchor namespaces, a persistent Anchor Approve API, Human Visual Review files, real SHA-256 package import, whole-sprite micro motion, improved staging, and an ordinary prop-based collision burst without modifying the frozen Engine or Renderer.
