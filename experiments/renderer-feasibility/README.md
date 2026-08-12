# Renderer Feasibility Gate

This experiment proves the frozen rendering path without adding story semantics:

`RenderPlan -> PreparedRenderPlan -> FrameEvaluator -> RenderState -> PixiJS -> PNG -> FFmpeg -> MP4`

The internal pixel space is always 1280 x 720. Preview sizing is CSS-only. Final PNG export reads the same completed canonical WebGL framebuffer as Preview, avoiding a second RenderTexture pass. The automated gate requires exact RGBA equality at critical GroundLock, crossfade, socket/baked attachment, camera, and foreground-order frames.

Renderer determinism uses two fresh Pixi Applications for every critical frame. One renders the target directly; the other renders an arbitrary history first and then seeks back to the target. Both PNGs are decoded and compared as RGBA, so stale Sprite visibility, opacity, texture, display-list order, and crossfade state are covered.

The report separately measures steady-state FrameEvaluator, Pixi apply/render, PNG encode/write, FFmpeg encode, determinism-test elapsed time, and the 300-frame pipeline elapsed time.

Run from the repository root:

```powershell
pnpm --filter @pose-clip/renderer-feasibility feasibility
```

Run the hardware-GPU baseline separately:

```powershell
pnpm --filter @pose-clip/renderer-feasibility feasibility:gpu
```

For environments where the Node sandbox cannot spawn FFmpeg, run the browser pass with `--skip-ffmpeg`, invoke FFmpeg externally, and record that measured duration with `--ffmpeg-ms` in the retained report workflow.

Generated artifacts are written to the ignored `output/swiftshader/` and `output/gpu/` directories.
