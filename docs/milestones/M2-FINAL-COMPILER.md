# M2 Final Compiler

状态：Commit 6B PASS / Frozen

## 唯一输出

Final Compiler 现在执行：

`FinalCompileInput -> Input Integrity -> Duration Solver -> Canonical Timeline -> RenderPlan -> RenderPlan Integrity -> PreparedRenderPlan`

系统只持久化一个 `RenderPlan` 和其中一个 Canonical `Timeline`。`SolvedTimingPlan` 仍是 Final Compiler 内部临时数据，不新增 CompiledTimeline、ExecutionTimeline 或 ResolvedTimeline。

## v0.1 已实现范围

- 单 Scene、2–3 Shot、多个已绑定 Character
- Scene 到 Environment、Character 到 EntityDefinition/EntityInstance 的确定绑定
- Blocking Intent 到 GroundPoint
- Required Action Timing 与明确 `poseClipId` 到 PoseEvent/Cut PoseTransition
- `completionPolicy` 使 Action 结束帧真正结束 Pose；相邻 Action 同帧直接切换，不插入默认 Pose
- `spatialMode=locomotion` 要求 `destinationBlocking`，并把动作区间编译为 GroundPosition 位移
- Initial、Shot 与 Destination Placement 统一通过 Environment Capability Gate
- Action 使用显式 `defaultDirection`，不依赖 supportsDirections 数组顺序
- M2 的 facing 仅用于 Locomotion Destination，并且必须与解析后的 Action direction 一致
- Camera Intent 到显式 CameraTrack
- Follow Camera 必须绑定 focusEntityId，并从目标 EntityTrack 经 Ground Projection 生成 CameraTrack
- Narration Timing 到 NarrationCue 与 SubtitleCue
- 连续 Shot、Cut Transition、EntityTrack
- Preflight、Duration 与 Optional Drop diagnostics 汇总到 provenance warnings
- Schema、RenderPlan Integrity 与 Frozen Paper Engine prepare gate

当前 Golden 测试从语义输入自动产生 22 秒、2 Shot、2 Character 的 Renderer-ready RenderPlan，并验证重复编译的结构和 semantic hash 完全一致。RenderState 集成测试同时锁定：Run 区间结束回 Idle、Locomotion 实际移动、Follow Camera 与 Rabbit 世界位置同步。

## 暂不支持

- 多 Scene
- Initial/Shot Blocking 的 facing 驱动 Pose（M2 Schema 明确拒绝该字段）
- 复杂 Ownership
- 多角色并行动作
- Optional Action placement
- 复杂 Effect System
- Scene Asset Streaming

下一步进入 Compiler Golden Artifact、20–30 秒自动 RenderPlan Fixture，以及 Subtitle/Audio mux。
