# M2.1 Visual Quality Recovery

状态：Gate Hardening 实现完成，等待本机 Qwen3-TTS 完整渲染与人工 Visual Acceptance。

本实验不修改 Frozen 的 Compiler、Canonical Timeline、Paper Engine、GroundLock、Pixi RenderState 或 Ownership 合同。Final Compiler 先生成基础 RenderPlan，确定性的 Visual Recovery Planner 仅负责：

- 1.5× Environment Overscan 与 Camera Safe Bounds；
- Focus composition、Lead Room 和轻微镜头推进；
- stump Landmark、impact、Rabbit collision/lying；
- Farmer notice/walk/bend/pickup/hold-rabbit；
- Farmer 1.0 / Rabbit 0.35 canonical relative scale；
- 本地 Qwen3-TTS（默认 Serena）真实旁白；SAPI 仅作为显式 fallback；Fake TTS 仅用于 CI/契约测试；
- Timeline Subtitle → ASS → FFmpeg Burn-in，同时保留 mov_text 轨；
- 最终 PNG 99.5% Coverage Gate、边缘 Coverage Gate、64×36 灰度 Meaningful Motion Gate、Visual Event Cadence Gate；
- Story Action、stump、Camera Safe Bounds 和 Rabbit/Farmer 0.3～0.4 相对身高 Gate。

运行：

```text
pnpm --filter @pose-clip/m2.1-visual-quality visual-acceptance
```

默认 Qwen3-TTS 路径为：

```text
D:\Study\githubV2\runtime\python\Scripts\python.exe
D:\Study\githubV2\models\huggingface\hub\models--Qwen--Qwen3-TTS-12Hz-1.7B-CustomVoice\snapshots\0c0e3051f131929182e2c023b9537f8b1c68adfe
```

可通过 `M21_QWEN_PYTHON`、`M21_QWEN_MODEL`、`M21_QWEN_DEVICE`、`M21_QWEN_SPEAKER` 覆盖。`M21_TTS_PROVIDER=sapi` 才会显式使用 Huihui fallback；不会在 Qwen 失败时静默降级。Chrome/Edge、FFmpeg 和 FFprobe 仍是必需运行依赖，可通过 `POSE_CLIP_FFMPEG`、`POSE_CLIP_FFPROBE` 指定。

`M21_CONTRACT_ONLY=1` 只验证 Story → Compiler → RenderPlan 契约；它生成测试 Tone，最终验收脚本会明确拒绝该模式，不能产生 PASS。

Technical Gate 通过后只写入 `candidate/`，不会写 `frozen/`。观看 candidate 视频后执行：

```text
node scripts/review-candidate.mjs --approve --reviewer "姓名" --notes "十项视觉检查通过"
```

若不通过则执行 `--reject`。只有 technical report、candidate MP4 SHA-256 和人工 `visual-review.json` 三者一致且状态为 `approved` 时，才晋级 `frozen/`。

只有技术 Gate 与人工观感审核都通过后，才能标记 `M2.1 Visual Acceptance = PASS`。
