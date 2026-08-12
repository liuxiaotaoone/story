# M2 Duration Solver

状态：Commit 5 implemented

## 边界

`SolvedTimingPlan` 只存在于 `packages/compiler/src/timing`，是 Final Compiler 的临时内存结果：

- 不属于 `packages/schemas`
- 不持久化为 JSON
- 不计算内容 Hash
- 不提供给 Renderer
- 不替代 Canonical Timeline
- Final Compiler 消费后立即丢弃

## 确定性规则

每个 Shot 独立计算三条时间车道：

1. Narration 按 Segment 顺序串行，音频帧转换为视频帧：`ceil(sampleFrameCount * fps / sampleRate)`。
2. Required Action 按 `sequence` 串行，最小时长为 `minDurationFrames` 之和。
3. Camera 使用 Capability Catalog 的 `minDurationFrames`。

Director 的 `minSeconds` 向上量化，`preferredSeconds` 四舍五入，硬 `maxSeconds` 向下量化。Shot 内容最小时长取 Narration、Actions、Camera 和 Director Minimum 的最大值：

- preferred 大于等于 minimum：使用 preferred。
- preferred 小于 minimum：扩展到 minimum，并产生 `SHOT_EXPANDED_FOR_CONTENT` Warning。
- minimum 超过 hard max：返回 `DURATION_UNSATISFIABLE` Error，不生成部分 Timing Plan。

不同 Shot 严格首尾相接；所有输出都是整数 Frame。实现不读取 wall clock、不使用随机数，也不保留前次运行状态。

## 下一步

Commit 6 Final Compiler 开工前先完成精确 PoseClip Binding：每个 `ExpandedAction.requiredPoseClipIds` 必须存在于 ResolvedAssetCatalog，且对应 EntityDefinition 必须声明这些 Clip。
