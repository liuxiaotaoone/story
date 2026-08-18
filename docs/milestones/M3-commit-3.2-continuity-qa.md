# M3 Commit 3.2 — PoseClip Continuity QA

状态：**PASS / Frozen (closed by M3 Commit 3.2.1)**

本提交只消费 M3 Commit 3.1 已冻结的 `PoseClipFrameProductionResult[]`，不修改 Generation、Resume、CAS、Processor、单帧 QA 或 Frame Cache。

## 数据流

```text
PoseClipFrameProductionResult[]
→ Feature Extractor（Spec + 可选 Model Hash + Config）
→ per-frame Continuity Features
→ deterministic adjacent-frame comparison
→ optional last-frame → first-frame loop comparison
→ PoseClipContinuityEvaluation
→ PoseClipProductionResult
```

`PoseClipProductionResult` 内嵌完整 `continuityEvaluation`。Evaluation 绑定：

- `continuityQaSpecHash`；
- 有序 `frameResultHashes`；
- Loop 语义；
- 八类 Metric Result；
- Diagnostics 与 `automatedReady`；
- `evaluationHash`。

最终 Result Integrity 强制 Continuity Evaluation 的 Frame Hash、Loop 与 Clip QA 汇总字段完全一致。

## Feature Extractor Identity

真实 Identity、Body Proportion 和 Silhouette 不能从 AssetRecord 元数据猜测，因此 Extractor 是显式、可替换且可哈希的依赖：

```text
extractor.name/version
+ model.id/contentHash（可选）
+ config
↓
extractorSpecHash
↓
continuityQaSpecHash
```

当前 `DeterministicReferenceContinuityFeatureExtractor` 只从 `spec.config.frames` 读取测试特征，不含隐藏构造状态。配置改变会同时改变 Extractor Spec Hash 与 Continuity QA Spec Hash。生产模型上线时必须验证实际模型 bytes 与声明的 Model Hash。

每份 Frame Feature 必须绑定：

- `frameIndex`；
- Anchored Artifact `contentHash`；
- Anchored Asset 的 Canvas Width / Height。

绑定错误在计算任何 QA 结果前 fail-fast。

## 指标合同

每项指标拥有独立 `warning` 与 `failure` 阈值，且 `warning <= failure`：

- Identity Consistency：相邻 Identity Embedding 的 RMS Delta；
- Scale Consistency：相邻 Subject Bounds 等效尺度的相对变化；
- Canvas Consistency：相邻 Anchored Asset 尺寸是否一致；
- Body Proportion：相邻 Body Proportion Vector 的 RMS Delta；
- Foot Contact：接触脚或双脚中点与 Frame Foot Anchor 的距离；
- Anchor Movement：相邻 Foot / Center Anchor 的最大位移；
- Silhouette Continuity：相邻 Silhouette Embedding 的 RMS Delta；
- Loop Closure：Loop Clip 的最后一帧到第一帧综合 Delta；非 Loop 必须为 `not-applicable`。

Evaluator 保存每项最大 Delta、阈值以及最差 Frame / Frame Pair。Warning 与 Failure 会产生机器可读 Diagnostic。

## Production Ready

`automatedReady=true` 要求：

- 所有适用 Continuity Metric 均为 `passed`；
- 所有输入 Frame Result 的单帧 QA 均为 Production Ready。

`assemblePoseClipProductionResult()` 再合并 Frame Structural/Anchor QA 与人工审核：

```text
Automated Continuity PASS
+ every Frame QA PASS
+ Human Review approved
+ no error diagnostics
→ Clip productionReady=true
```

人工审核 `pending` 时，即使自动 Continuity 全部通过，最终 `productionReady` 仍为 `false`。

## 当前边界

- Reference Extractor 用于冻结 QA 数学、证据、Hash 与组装合同，不代表生产视觉模型；
- Identity / Body / Silhouette 的生产特征提取模型、真实 PNG 解码和模型文件 Hash 复核尚未实现；
- 本阶段不增加跨 Clip、跨方向或跨角色的比较；
- 不修改已经 Frozen 的单帧 Production Pipeline。

进入生产 Feature Extractor 前，应先用已知 Good/Bad PoseClip 数据集校准阈值，避免以合成 Fixture 阈值冒充生产标准。
