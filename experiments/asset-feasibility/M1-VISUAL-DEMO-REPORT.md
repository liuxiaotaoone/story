# M1 High-quality Visual Demo v0.1

Status: **Implementation complete / visual review candidate**  
Date: 2026-08-12

## Improvements over M0

- Existing Anchor JSON loads automatically on every frame; metadata is character-scoped under `anchors/farmer` and `anchors/rabbit`.
- Approve persists `reviewStatus=approved` through the experiment Vite API; downloads remain available for review handoff.
- 27 character images pass policy-driven normalization. Only uniform whole-sprite Scale and Translate are allowed; crouched, composite and lying policies remain exempt from standing-height normalization.
- The compiled Asset Package is generated from Manifest + Structural QA + Human Review. RenderPlan assets use real SHA-256 values and imported QA status; no zero hashes or hard-coded passed status remain.
- Human Review is explicit: identity passes, Walk/Run continuity remains warning, anchor approval remains open, and `productionReady=false` is machine-readable.
- Rabbit is visible from Frame 0. Farmer exists in the distant scene from Frame 0, then Camera Pan and whole-sprite motion stage the discovery; there is no visibility pop-in.
- Collision uses a generated paper impact sprite imported as an ordinary prop Entity with deterministic Visibility Events. Renderer Effect support remains untouched.
- Farmer idle has subtle whole-sprite uniform scale and ±0.3° rotation keyframes; there is no bone, morph or non-uniform deformation.

## Verification target

`output/m1-high-quality-demo-10s.mp4`: canonical 1280×720, 30 FPS, 300 frames, H.264. The M1 sequence is Rabbit Run (0–3s), Collision (3–5s), Lying (5–7s), Farmer Notice/Reaction (7–10s).

## Remaining production blockers

- Human approval of all auto-estimated anchors.
- A second visual pass on Walk/Run pose continuity.
- Independent reproduction requires generated/processed/normalized local artifacts, which remain intentionally Git-ignored due size.

M1 v0.1 is a visual review candidate, not approval for automated scale production.
