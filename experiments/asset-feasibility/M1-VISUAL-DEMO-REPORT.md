# M1 High-quality Visual Demo v0.2.1

Status: **PASS / Frozen**  
Date: 2026-08-12

## Visual closure

- 28 character images pass policy-driven normalization. Only uniform whole-sprite Scale and Translate are allowed; crouched, composite and lying policies remain exempt from standing-height normalization.
- The compiled Asset Package is generated from Manifest + Structural QA + Human Review. RenderPlan assets use real SHA-256 values, imported QA status, reference-input hashes and prompt-file hashes.
- Import mode is explicit: experiment mode accepts `productionReady=false`; production mode rejects it.
- Human Review is explicit: identity passes, key M1 anchors are approved, Walk/Run continuity remains warning, and `productionReady=false` remains machine-readable.
- Rabbit is clearly visible from Frame 0 and fully readable inside the first 0.5 seconds; there is no visibility pop-in.
- Collision uses a generated paper impact sprite imported as an ordinary Entity with deterministic Visibility Events. Its nearer depth places it over the rabbit while the frozen foreground layer still provides occlusion; Renderer Effect support remains untouched.
- Farmer idle has subtle whole-sprite motion. Frames 206–209 add anticipation and Frame 210 performs a deterministic Cut to the generated `farmer.notice-right` pose, eliminating whole-body crossfade ghosting.
- `farmer.notice-right` preserves identity while clearly directing gaze, torso, lean, raised hand and surprised concern toward the rabbit.
- Farmer remains at the same Ground Position `(u=0.21, v=0.58)` for the complete 300-frame shot. Frames 165–240 use Camera Pan only; neither `farmer.idle` nor `farmer.notice-right` performs static-pose locomotion.

## Verification target

`output/m1-high-quality-demo-10s.mp4`: canonical 1280×720, 30 FPS, 300 frames, exactly 10 seconds, H.264. The sequence is Rabbit Run (0–3s), Collision (3–5s), Lying (5–7s), Farmer Notice (7–10s).

Automated Structural QA: **PASS, 34/34 source/processed assets** (including references inspected by QA).

Compiled Asset Package: **32 renderable assets, 14 PoseClips**. TypeScript check, importer/staging tests, Python contract tests and Vite production build pass.

## Remaining production blockers

- Human approval of remaining non-key auto-estimated anchors.
- Production-quality regeneration or correction of Walk/Run loops; the second visual pass deliberately retained continuity warnings.
- Independent reproduction requires generated/processed/normalized local artifacts, which remain intentionally Git-ignored due size.

M1 v0.2.1 proves the 10-second visual route and is frozen. It is not approval for automated scale production; that distinction is enforced by the production importer gate.
