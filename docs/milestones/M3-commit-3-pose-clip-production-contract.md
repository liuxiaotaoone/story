# M3 Commit 3.0.1 — Multi-frame PoseClip Production Contract Closure

状态：**PASS / Frozen**

本提交只建立多帧 Whole-body PoseClip 的生产契约、内容哈希与完整性边界，不修改已冻结的 Compiler、Timeline、Paper Engine、Renderer 或 ComfyUI Provider 语义，也不执行真实图片生成。

## 核心决策

一个四帧 PoseClip 不是一次 `expectedCount=4` 的黑盒生成，而是四个独立的单图任务：

```text
PoseClipProductionRequest
├── FrameJob 0 → ActionGenerationRequest(expectedCount=1)
├── FrameJob 1 → ActionGenerationRequest(expectedCount=1)
├── FrameJob 2 → ActionGenerationRequest(expectedCount=1)
└── FrameJob 3 → ActionGenerationRequest(expectedCount=1)
```

每一帧都拥有独立的：

- `frameIndex`、phase 与 `poseIntent`；
- `durationFrames`、foot contact 与 `referenceFoot`；
- required anchors、seed、reference assets 与 output identity；
- `frameSpecHash` 和由它参与计算的 Generation `inputHash`；
- 绑定完整 FrameSpec 与 GenerationRequest 的 `frameJobHash`。

因此修改任意帧的姿态、接触、Anchor 要求或引用资产，只会使该帧的 `frameSpecHash`、Generation `inputHash` 与 `frameJobHash` 失效；其他帧的生成及完整处理结果仍可复用、独立重试和独立审核。

`PoseClipFrameProductionResult` 只绑定 `frameJobHash`，不绑定全局 `productionRequestHash`。全局 Hash 仅由最终 `PoseClipProductionResult` 绑定。修改 Frame 2 后，Frame 0、1、3 的 Frame Result 因 `frameJobHash` 未变，可以直接进入新 Request 的最终组装。

## 生产证据链

每个 `PoseClipFrameProductionResult` 必须保存四个显式阶段：

```text
GenerationRequest.inputHash
→ raw
→ matted
→ normalized
→ anchored
→ PoseClipFrame
```

每个阶段都有自己的输入 Hash、Producer、视觉 `AssetRecord` 和输出 Hash；后一个阶段必须绑定前一个阶段的输出 Hash。最终 `PoseClipFrame.assetId` 必须指向 anchored artifact，且实际 Anchor 集合必须满足 FrameSpec 的 required anchors。

所有 Production Artifact 必须使用：

```text
asset.uri = asset://sha256/<asset.contentHash>
```

物理目录由 Local CAS Adapter 解析，不参与 Artifact、Frame Result 或 Production Result 的内容身份。相同 bytes 从一个磁盘迁移到另一个磁盘不会使生产 Hash 失效。

## 最终组装

`PoseClipProductionResult` 只能按照 Request 中的连续 Frame 顺序组装：

```text
FrameProductionResult[]
→ PoseClip
→ pose-clip-v1 content hash
→ PoseClipProductionResult hash
```

完整性检查会拒绝：

- FrameSpec、GenerationRequest 或 ProductionRequest 的 Hash 漂移；
- 非连续 Frame、重复输出 Asset ID 或上下文不一致；
- Artifact 阶段缺失、乱序、断链或内容身份被篡改；
- 缺少 required anchor，或 PoseClipFrame 与 FrameSpec 不一致；
- 最终 PoseClip 不是由这些 Frame Result 唯一组装而成；
- production-ready Clip 中存在未通过的帧 QA、连续性 QA 或人工审核。

失败的连续性/Loop QA 仍可作为 `productionReady=false` 的有效生产结果保存，供重试与人工诊断；系统不得把它晋级为可生产 PoseClip。
Loop Clip 的 `loopClosure` 必须是 `pending / passed / warning / failed` 之一，不允许 `not-applicable`；非 Loop Clip 则必须使用 `not-applicable`。

## QA 合同

帧级 QA 冻结为 Structural、Matting、Normalization、Anchors。Clip 级连续性 QA 预留并显式记录：

- Identity、Scale、Canvas 与 Body Proportion；
- Foot Contact 与 Anchor Movement；
- Silhouette Continuity；
- Loop Closure；
- Human Review 与 Production Readiness。

Commit 3.0 不实现这些算法。后续 Commit 3.1 实现独立处理阶段，Commit 3.2 实现跨帧连续性 QA；在真实验证之前不扩展正式 Compiler 或 Renderer 合同。

## 验证

Golden/negative tests 固定四帧 rabbit run 请求的 FrameSpec Hash、Generation Input Hash、FrameJob Hash 与 Production Request Hash，并覆盖：

- 单帧 `expectedCount=1` 约束；
- FrameSpec 变化使该帧生成 Hash 失效；
- 非连续 Frame 与重复 Asset ID 拒绝；
- 四阶段 Artifact 链与 PoseClip 唯一组装；
- 单帧变更后其余三个完整 Frame Result 可跨新 Request 复用；
- Production Artifact 拒绝物理 `file://` URI；
- Artifact 身份篡改与 required anchor 缺失 fail-closed；
- Loop QA 失败只能保存为非 production-ready 结果。

Processor 配置、模型 Hash、阈值、Canvas、Padding 与 Anchor Detector 配置不在 3.0.1 中提前定义；它们将在 Commit 3.1 以 `processorSpecHash`（或等价的 Stage Spec Hash）进入各阶段缓存身份。
