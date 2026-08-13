# M3 Commit 1 — Action Package Contract

状态：**Implemented / Awaiting Final Freeze Review**（Commit 1.1 Content Integrity 与 Commit 1.2 Compatibility Integrity 已完成）

## 目标

Action Package 是可生产、可缓存、可 QA 的完整动作资产单位。它把已经验证过但原先分散在 Capability Catalog、PoseClip、Interaction 与 Asset Catalog 中的声明组织成一个有 Hash 和完整性边界的包，不引入第二套 Action 或 Timeline 语义。

```text
Action Package
→ Hash / Integrity
→ deterministic Capability Adapter
→ Capability Catalog
→ Preflight
→ Final Compiler
→ one Canonical RenderPlan
```

## 冻结合同

- `variants[]` 是 Direction 到完整人物 `poseClipId + poseClipHash` 的唯一映射；每个 Direction 和 PoseClip ID 在包内唯一，Hash 绑定 PoseClip 的 Frame、Anchor、时长、GroundLock 与 Composite Slot 等完整语义。
- `targetPolicy = none | optional | required` 显式决定 Director `targetId` 合法性，不再通过 `interaction` 是否存在间接推断。
- `interaction` 只允许出现在 `targetPolicy=required` 的 Package/Capability；Contact、Effect、Baked Ownership 继续使用已有正式 Schema。
- `requiredAssets[]` 必须唯一，每项保存 `contentHash`，必须与 Asset Manifest 的真实内容 Hash 一致；同 ID 替换文件会使 Integrity 失败。
- Asset Role/Kind 是正式约束：`pose-frame → character-frame|animal-frame`、`effect → effect`、`prop → prop`、`audio → audio`、`reference → character-frame|animal-frame|prop`。PoseClip Frame 必须引用 `role=pose-frame` 的资产。
- Package Variant 必须与实际 PoseClip 的 Entity Type、Action、Direction 一致。
- Baked Ownership 的每个 Variant PoseClip 都必须声明对应 Composite Slot，且 Slot Entity Type 必须在 `targetTypes` 中。
- `actorRequirements.attachmentSlots` 显式声明 Actor 前置条件；Baked Ownership 的 `ownerSlot` 必须在其中，并与实际 Actor `EntityDefinition.attachmentSlots` 做兼容性校验。
- Actor `EntityDefinition.poseClipIds` 必须声明 Package 的每个 Variant PoseClip；仅仅 Entity Type 相同不再视为兼容。
- `targetTypes` 在 Package 与 Capability 中都是非空唯一集合；`targetPolicy != none` 不允许形成“必须有 Target、但没有任何合法类型”的不可执行动作。
- `targetRequirements[]` 按 Target Entity Type 声明所需 Interaction Anchor。Package Contact 必须为每个合法 Target Type声明对应 Anchor Requirement。
- Package Resolution 要求每个 `targetType` 恰有一个 Target `EntityDefinition`，并在进入 Compiler 前验证 Target Type 与所需 Interaction Anchor。
- `packageHash` 使用 `canonicalHash('action-package-v1', payload)`；Hash 漂移直接失败。
- `productionReady=true` 只有在结构、连续性、Anchor 全部 PASS、人工审核 Approved 且没有 Error Diagnostic 时合法。
- Adapter 必须显式选择 `experiment | production`：Production 要求 Package `productionReady=true`，并要求所有 Runtime Asset（除 Generation Reference 外）`qaStatus=passed`。

## Adapter 边界

`actionPackageToCapability(package, references, {mode})` 先完成 Hash、内容、兼容性和 Production Gate，再做确定性字段映射：

- `variants` → `requiredPoseClips` / `poseBindings` / `supportsDirections`
- `duration.minDurationFrames` → Capability 最小时长
- `targetPolicy` / `targetTypes` → Preflight Target Validation
- `spatialMode` / `completionPolicy` / `interaction` / `attachmentMode` → 既有 Compiler 语义

Adapter 不生成 Timeline，不读取 Pixel/Renderer 状态，也不猜缺失方向或资产。

## Ownership 时间边界

Solved Action 使用半开区间 `[startFrame, endFrame)`：

- `action-start` → `startFrame`
- `action-end` → `endFrame - 1`（最后活动帧）

Ownership Event 不允许落到不可渲染的 `timeline.durationFrames` 边界。

## Golden Package

第一份 Golden Package 是 `farmer.pickup-rabbit`，覆盖：

- Whole-body Composite PoseClip
- Target Required
- Contact Anchor
- Baked Ownership
- Owner Slot / Composite Slot
- Action-end 边界
- Required Assets
- Provenance / Canonical Hash
- Automated QA / Human Review / Production Ready

Commit 1.2 后 Golden Package Hash 为：

```text
ec694fe37ba17312fe754d7dcb5f28ff8f6b4393b9f397b8054ca7d5739564ba
```

## 非本提交范围

- ComfyUI / Flux.2 Provider
- AI 图片生成
- Compiler 内部 `__compiler.*` 保留 ID Namespace
- Pixel Coverage QA 产品化
- Paper Engine / Pixi Renderer 修改
