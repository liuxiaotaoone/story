# M0 Paper Engine v0.1 — Semantic Hardening

状态：完成，Renderer-ready，停止在 Pixi Adapter 之前。

## Exit Criteria

- [x] RenderPlan 只在 `prepareRenderPlan()` 中验证一次，Evaluator 只接受 `PreparedRenderPlan`。
- [x] Prepared 计划深度冻结，索引通过运行时不可写的 `ReadonlyMap` 视图暴露。
- [x] Ownership Timeline 在逐帧求值前拒绝重复事件、陈旧 `from`、自挂载、环和两层以上所有权。
- [x] Baked Attachment 必须绑定活动 Owner PoseClip 中类型匹配的 Composite Slot。
- [x] GroundLock 以接触段为单位锁定世界点，直接求值任意帧不依赖历史缓存。
- [x] Crossfade 权重与实体透明度分离；同一 Entity 最多输出两个有共同 transitionId 的临时 Sprite。
- [x] Sprite RenderState 显式携带 world/screen CameraSpace；环境层 parallax influence 由 Evaluator 固化。
- [x] ContentHash 为小写 64 位 SHA-256；语义 RenderPlan Hash 排除 compiledAt/warnings 等审计字段。
- [x] Task Dependency 的 cache material 保留 role、nodeId、outputHash，不再仅排序裸 Hash。
- [x] Golden Fixture V2 与固定种子的随机属性测试通过。

## Frozen Renderer Contract

Renderer 对 world sprite 应使用 `cameraSpace.influence` 处理 Camera 位移；screen sprite 保持输入坐标。参考实现由 `resolveCameraSpacePoint()` 给出。Renderer 不得重新解释 Ownership、GroundLock、Pose Transition 或 parallax。

## 下一步

进入 M0 Renderer Gate：建立最小 Pixi Adapter，对同一 `PreparedRenderPlan` 的 Preview 与离线 Frame Export 做像素级一致性比较。该工作应创建独立包，不修改 Paper Engine 的领域语义。
