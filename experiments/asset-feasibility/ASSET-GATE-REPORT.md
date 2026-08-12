# M0 AI Asset Gate Report

Status: **PASS / Asset pipeline feasible**  
Date: 2026-08-12  
Scope: Asset Feasibility v0.1; no Gemini Director and no full ComfyUI platform.

## Evidence

| Gate item | Result | Evidence |
|---|---:|---|
| Farmer identity, 8+ states | PASS | Reference plus 13 target images; hat, face, three jacket toggles, red sash, body proportions and palette remain recognizable in the contact sheet. |
| Farmer Walk/Run PoseClip | PASS | Walk ×4 and Run ×4 share one 1024×1536 canvas and play in the 4–12 FPS preview. |
| Rabbit package | PASS | Idle L/R, Run L/R ×4, Collision and Lying. Left/right Run pairs are deterministic mirrors. |
| Four-layer environment | PASS | Opaque Far plus alpha Mid/Ground/Foreground, all 1280×720 with frozen parallax factors. |
| Matting / alpha | PASS | Chroma-key pipeline produces RGBA cutouts; QA inspects alpha ratios and bounds. |
| Anchor metadata | PASS with production review required | All character assets contain normalized Foot/LeftFoot/RightFoot/LeftHand/RightHand/Center/Head estimates and load in the editor. |
| Automated QA | PASS | 31/31 assets passed, 0 warnings, 0 failures. Checks include files, decoding, SHA-256, dimensions, alpha, bbox, crop risk, anchor range and package canvas consistency. |
| Frozen renderer integration | PASS | New experiment RenderPlan uses existing `prepareRenderPlan`, `evaluateFrame` and `PaperPixiRenderer`; no paper-engine or paper-pixi source modification. |
| 10-second AI demo | PASS | 300 canonical 1280×720 frames at 30 FPS encoded to H.264 MP4. Contains AI Farmer, Rabbit, four AI environment layers, GroundLock, 3-frame Pose Crossfades, camera pan, parallax, foreground occlusion and shadow. |

## Gate findings

- The end-to-end asset contract is viable: generated whole-body assets can enter the frozen Renderer and form a coherent continuous 2.5D shot.
- The first failed render was useful evidence, not an engine defect. Marking every Rabbit Run frame as `both` contact created one 90-frame GroundLock segment. Correct alternating left/right contact semantics resolved the Hard Limit without changing the Engine.
- Automatic bbox-derived anchors are sufficient for feasibility and tooling validation, but production requires human review in the Anchor Editor.
- AI frames retain identity, but their internal body scale and foot height vary. A production normalization step should align subject scale and ground before anchors are approved; it is not required to pass feasibility v0.1.

## Decision

M0 AI Asset Gate passes. The next investment may proceed to a polished M1 10-second demo and later asset-worker automation. Do not promote experiment manifests into the formal RenderPlan Schema until the normalization and human-review workflow has one more production example.
