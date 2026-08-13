# M2.1 Visual Quality Recovery

状态：实现完成，等待本机完整渲染与人工 Visual Acceptance。

本实验不修改 Frozen 的 Compiler、Canonical Timeline、Paper Engine、GroundLock、Pixi RenderState 或 Ownership 合同。Final Compiler 先生成基础 RenderPlan，确定性的 Visual Recovery Planner 仅负责：

- 1.5× Environment Overscan 与 Camera Safe Bounds；
- Focus composition、Lead Room 和轻微镜头推进；
- stump Landmark、impact、Rabbit collision/lying；
- Farmer notice/walk/bend/pickup/hold-rabbit；
- Farmer 1.0 / Rabbit 0.35 canonical relative scale；
- Microsoft Huihui 中文真实 TTS；
- Timeline Subtitle → ASS → FFmpeg Burn-in，同时保留 mov_text 轨；
- 最终 PNG 99.5% Coverage Gate、边缘 Coverage Gate、Freeze Gate、Visual Event Cadence Gate；
- Story Action、stump、Camera Safe Bounds 和 Rabbit/Farmer 0.3～0.4 相对身高 Gate。

运行：

```text
pnpm --filter @pose-clip/m2.1-visual-quality visual-acceptance
```

运行环境需要 Windows SAPI 的 `Microsoft Huihui Desktop`、Chrome/Edge、FFmpeg 和 FFprobe。可通过 `POSE_CLIP_FFMPEG`、`POSE_CLIP_FFPROBE` 指定可执行文件。`M21_CONTRACT_ONLY=1` 只允许验证 Story → Compiler → RenderPlan 契约；它生成测试 Tone，最终验收脚本会明确拒绝该模式，不能产生 PASS。

只有技术 Gate 与人工观感审核都通过后，才能标记 `M2.1 Visual Acceptance = PASS`。
