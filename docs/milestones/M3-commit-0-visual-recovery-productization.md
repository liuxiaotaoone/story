# M3 Commit 0 — Visual Recovery Productization

状态：**PASS / Frozen**（Commit 0.1 Contract Hardening 已完成）

## 决策

M2.1 的 `applyVisualRecovery()` 保留在已冻结实验中作为历史证据，不进入生产调用链。M3 正式路径只允许：

```text
Story
→ DirectorPlan
→ EffectiveDirectorPlan
→ PreflightCompileResult
→ Final Compiler
→ one Canonical RenderPlan
→ Renderer
```

Final Compiler 不再输出供 Visual Recovery 二次修改的中间 RenderPlan。

## 能力归位

| M2.1 实验能力 | M3 正式归属 |
|---|---|
| Stump | `DirectorPlan.landmarks` + `ResolvedAssetCatalog.landmarkBindings` |
| Collision Contact | `ActionCapability.interaction.contact` + Entity `interactionAnchors` |
| Impact | `ActionCapability.interaction.effect` + `effectBindings` |
| Pickup / Hold | `interaction.ownership` + Composite PoseClip + Baked Ownership Event |
| Lead Room | Shot `composition` + Camera Compiler |
| Camera Safe Bounds | `EnvironmentDefinition.cameraSafeBounds` |
| Overscan | `EnvironmentDefinition.coverageContract` + Layer Transform validation |
| Qwen TTS | `packages/audio` `Qwen3TtsProvider` |
| Meaningful Motion / Cadence | `packages/visual-qa` |

## 确定性与边界

- 所有 Interaction 在 Preflight 中展开并进入 Hash，Final Renderer 不推理故事意图。
- Effect 使用 Catalog 绑定的可视 Entity 和确定 Visibility Event，触发帧由 Solved Action 决定。
- Baked Ownership 直接由 Final Compiler 产生，继续受 Composite Slot 和 Ownership Integrity 约束。
- Camera Composition 使用 Canonical 1280×720 像素空间，并在 Environment Safe Bounds 内 clamp。
- `packages/paper-engine` 与 `packages/paper-pixi` 无需修改。

## Commit 0.1 合同加固

- 任何定义 `interaction` 的 Action Capability 都必须有 Director `targetId`；否则 Preflight 输出 `INTERACTION_TARGET_REQUIRED` error，不会静默丢失 Contact / Effect / Ownership。
- Supplemental Effect Instance 只由 `SolvedTimingPlan` 中实际调度的 Action 产生；Optional Action 仍然按 `OPTIONAL_ACTION_DROPPED` 结束，缺少 Optional Effect Binding 不会使 Final Compile 失败。
- `Shot.focusEntityId` 是 Camera 编译的唯一 Focus Source。兼容期 `CameraIntent.focusEntityId` 仅用于一致性验证；Composition 必须有 Shot Focus，Follow 必须两者一致。
- Visual Cadence 按 Paper Engine 的 easing 语义判定：`hold` 区间不生成中间运动事件，只在终点记录跳变；连续 easing 才按间隔采样。

## 下一步

M3 Commit 1：Action Package Contract。将当前已有的 PoseClip、Interaction、Completion、Ownership 和 Direction Variant 组织成可生产、可缓存、可 QA 的 Action Package；在该契约冻结后再接 ComfyUI / Flux.2。
