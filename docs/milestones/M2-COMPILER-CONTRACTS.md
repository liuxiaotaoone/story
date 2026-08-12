# M2 Compiler Contracts

状态：Commit 1–3 implemented / Contract Hardening complete

## 本阶段范围

本阶段只建立 Story 到 Preflight 的契约层，不接入 Gemini、真实 TTS、Final Compiler，也不修改 Frozen 的 Paper Engine、Pixi Renderer 或 M1 Demo。

已实现的数据流：

```text
Story
  -> DirectorPlan
  -> DirectorOverride[]
  -> EffectiveDirectorPlan
  -> PreflightCompileResult
       - NarrationSegment[]
       - TtsRequest[]
       - AssetRequirement[]
       - ExpandedAction[]
       - CompileDiagnostic[]
```

## 冻结边界

- `DirectorPlan` 只表达场景、镜头、动作、角色调度、旁白和语义时长偏好。
- `DirectorPlan.sourceStoryHash` 将 Director 输出绑定到 Story 的确切内容；跨对象校验同时检查 Story ID、角色类型与 Beat 引用。
- `DirectorPlan` 禁止出现 Frame、像素坐标、资产绑定、PoseClip 帧索引、GroundLock、Timeline 和 Pixi 状态。
- `DirectorOverride` 必须绑定 `sourceDirectorPlanHash`，只能修改 DirectorPlan 的语义集合，应用后必须重新通过完整 Schema Validation。
- 应用层创建 EffectivePlan 的唯一公开入口是 `createEffectiveDirectorPlan({story, directorPlan, overrides})`；原始 Override 应用器不作为包级 API 导出。
- 人工不能通过 Override 修改 RenderPlan 或 Timeline。
- `PreflightCompileResult` 是 Final Compiler 的输入，不是第二套 Timeline。
- Preflight 同时记录 EffectivePlan Hash 与 CapabilityCatalog Version/Hash，禁止两阶段语义漂移。
- Preflight 对全部编译输出计算 `preflightHash`；持久化后的 Narration、Action、AssetRequirement 或 Diagnostic 被修改都会在 Final Gate 失败。
- Final Compile 输入必须携带 EffectiveDirectorPlan、Preflight、MeasuredAudio、CapabilityCatalog、ResolvedAssetCatalog 与显式 FinalCompileContext；任一 Hash 不一致或 Preflight 含 Error 时立即停止。
- `ResolvedAssetCatalog` 是正式资产解析契约，包含 AssetManifest、PoseClip、Environment、EntityDefinition 与 CharacterAssetBinding，并区分 experiment/production Gate。
- 同一 Shot 内 Action 按唯一 `sequence` 串行执行；同一角色每个 Shot 只能有一条 BlockingIntent。
- Capability Catalog 中所有被编译器按键查找的集合都必须唯一。
- TTS 时长的权威值为 `sampleFrameCount / sampleRate`；`durationSeconds` 不进入 `MeasuredAudio` Schema。
- `MeasuredAudio.sourceTtsRequestHash` 必须与对应 TTS Request 的 `inputHash` 一致，禁止旧 WAV 按相同 Request ID 误复用。
- 缺失能力只能产生 Rewrite/Fallback 或结构化 Compile Diagnostic，不允许 Renderer 猜测故事意图。

## 当前 Preflight 职责

- Director/Capability Schema Validation
- Narration Segmentation
- Deterministic TTS Request Generation
- Action Expansion 与 Capability Fallback
- Camera、Environment、Blocking Capability Validation
- Asset Requirement Resolution
- Structured Compile Diagnostics

## 下一阶段

Contract Hardening 已完成。Commit 4 从 Fake TTS 与 WAV/FFprobe 测量开始；Final Compiler、唯一 Canonical Timeline 与 20–30 秒 MP4 不属于当前版本。
