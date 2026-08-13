# M2 Vertical Slice

状态：实现完成，自动媒体 Gate PASS。

该实验只消费 Frozen 的 Compiler、Paper Engine 和 Pixi Renderer。固定 Story 经由 DirectorPlan、Preflight、Fake TTS、MeasuredAudio 与 Final Compiler 自动生成唯一 RenderPlan；Timeline 不允许人工编写或修改。

自动链路：

`Story -> DirectorPlan -> EffectiveDirectorPlan -> Preflight -> Fake TTS -> MeasuredAudio -> Final Compiler -> Canonical RenderPlan -> FrameEvaluator -> Pixi -> PNG -> FFmpeg -> MP4`

输出合同：

- `generated/artifacts/render-plan.json` 与 Semantic Hash
- `generated/artifacts/subtitles.srt`
- `generated/artifacts/narration-master.wav`
- `output/m2-vertical-slice-22s.mp4`
- `output/m2-vertical-slice-report.json`

运行：

```text
pnpm --filter @pose-clip/m2-vertical-slice vertical-slice
```

如果 FFmpeg/FFprobe 不在 PATH，分别设置 `POSE_CLIP_FFMPEG` 与 `POSE_CLIP_FFPROBE` 为可执行文件绝对路径。
