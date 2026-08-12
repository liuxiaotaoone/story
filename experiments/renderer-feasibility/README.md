# Renderer Feasibility Gate

This experiment proves the frozen rendering path without adding story semantics:

`RenderPlan -> PreparedRenderPlan -> FrameEvaluator -> RenderState -> PixiJS -> PNG -> FFmpeg -> MP4`

The internal pixel space is always 1280 x 720. Preview sizing is CSS-only. Final PNG export reads the same completed canonical WebGL framebuffer as Preview, avoiding a second RenderTexture pass. The automated gate requires exact RGBA equality at critical GroundLock, crossfade, socket/baked attachment, camera, and foreground-order frames.

Run from the repository root:

```powershell
pnpm --filter @pose-clip/renderer-feasibility feasibility
```

Generated artifacts are written to the ignored `output/` directory.
