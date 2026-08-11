# M0 Paper Engine v0.1 — Semantic Hardening

状态：完成，Renderer-ready，停止在 Pixi Adapter 之前。

## Exit Criteria

- [x] RenderPlan 只在 `prepareRenderPlan()` 中验证一次，Evaluator 只接受 `PreparedRenderPlan`。
- [x] Prepared 计划深度冻结，索引通过运行时不可写的 `ReadonlyMap` 视图暴露。
- [x] Ownership Timeline 在逐帧求值前拒绝重复事件、陈旧 `from`、自挂载、环和两层以上所有权。
- [x] `preserveWorldTransform=true` 在 MVP Schema 中非法；Detach 保位只能由 Compiler 显式写入 World Track Keyframe。
- [x] Baked Attachment 必须绑定活动 Owner PoseClip 中类型匹配的 Composite Slot。
- [x] Baked Ownership Event 不得位于 Child 或 Owner 的 Pose Crossfade 区间内。
- [x] GroundLock 以接触段为单位锁定世界点，直接求值任意帧不依赖历史缓存。
- [x] GroundLock 上限使用包含 Foot Anchor 差异、Asset Size 和 Scale 的完整 `visualCorrectionPx`；World Position Correction 独立保留。
- [x] Crossfade 权重与实体透明度分离；同一 Entity 最多输出两个有共同 transitionId 的临时 Sprite。
- [x] `anchorPolicy=foot|center` 均有实际求值语义，from/to 对齐到同一个按 Crossfade Weight 混合的 World Point。
- [x] Socket Attachment 在 Owner Crossfade 中按权重混合 Anchor Position、Rotation 与 Scale，不选择单一 Pose。
- [x] Socket Child 继承 Owner 的 Visibility、Scene 和 activeRange 可渲染性，不因合法 Owner 暂时不可见而抛异常。
- [x] PoseTransition 的 `fromPoseClipId` 必须等于开始前实际 Pose，同一 Entity 的 Transition 区间不得重叠。
- [x] 每个 Shot 必须且只能有一个显式 CameraTrack，首个 Position/Zoom/Rotation Keyframe 必须位于 Shot 起始帧。
- [x] Sprite RenderState 显式携带 world/screen CameraSpace；环境层 parallax influence 由 Evaluator 固化。
- [x] ContentHash 为小写 64 位 SHA-256；语义 RenderPlan Hash 排除 compiledAt/warnings 等审计字段。
- [x] Task Dependency 的 cache material 保留 role、nodeId、outputHash，不再仅排序裸 Hash。
- [x] 18 份完整 RenderState Golden JSON 与固定种子的随机属性测试通过。

## Frozen Renderer Contract

令 `C = viewportCenter`、`P = worldPosition`、`I = cameraSpace.influence`，冻结公式为：

```text
translated = P + (C - camera.position) * I
screenPosition = C + rotate(translated - C, -camera.rotation) * camera.zoom
screenScale = worldScale * camera.zoom
screenRotation = worldRotation - camera.rotation
```

`camera.position` 表示 influence=1 时显示在视口中心的 World Position。screen-space transform 原样返回，不受 position、zoom 或 rotation 影响。参考实现为 `resolveCameraSpaceTransform()`；Renderer 不得重新解释 Ownership、GroundLock、Pose Transition 或 parallax。

## 下一步

进入 M0 Renderer Gate：建立最小 Pixi Adapter，对同一 `PreparedRenderPlan` 的 Preview 与离线 Frame Export 做像素级一致性比较。该工作应创建独立包，不修改 Paper Engine 的领域语义。

P2 延后项：Effect 的 `targetEntityId`、Position、CameraSpace、RenderLayer 和 zIndex 空间解析放在 M1 视觉 Demo 前完成，不阻塞当前 Pixi Renderer Gate。
