# M4 Commit 5 — Production Bridge & Real Continuity

状态：**Bridge Contract / Execution Identity / RGBA Feature / Evidence Gate PASS；Overall Candidate**

本提交把已经完成的四个 M4 真实资产阶段正式接回 M3 Frozen Production Pipeline，并以真实 Anchored RGBA bytes 替换 fixture Continuity Features。M3 Frame Result、Continuity QA 和 Production Assembly Schema 均保持不变。

```text
RawGenerationResult
+ MattingResult
+ NormalizationResult
+ AnchoringResult
          ↓
PoseClipFrameProductionBridge
          ↓
PoseClipFrameProductionResult × 4
          ↓
Anchored CAS RGBA revalidation
          ↓
RGBA Continuity Features
          ↓
DeterministicPoseClipContinuityEvaluator
          ↓
PoseClipContinuityEvaluation
```

## Formal Frame Production Bridge

`PoseClipFrameProductionBridge` 首先递归验证 Raw → Matted → Normalized → Anchored 的完整 Result / Artifact Hash 链，然后逐帧组装：

```text
artifacts = [raw, matted, normalized, anchored]
poseFrame.assetId = FrameSpec.output.assetId
poseFrame.anchors = AnchoringResult.anchors
QA = required-anchor-frame-qa
```

Bridge 不生成临时或随机 `frameExecutionKey`。它复用 M3 Frozen 身份：

```text
frameJobHash
+ matted.processorSpecHash
+ normalized.processorSpecHash
+ anchored.processorSpecHash
+ frameQaSpec.qaEvaluatorSpecHash
+ pose-frame-production-executor@0.1.2
→ frameExecutionKey
```

`frameJobHash` 已绑定 Generation Request，因此 Generation identity 也进入最终执行身份。Bridge 生成的每个结果都带真实 key 调用 `assertPoseClipFrameProductionResultIntegrity()`，并把 expected key 一并传入校验。所有上游 Result 和 Artifact 保持 immutable。

## Real RGBA Continuity Features

`rgba-continuity-features@1.0.0` 是 algorithmic extractor，不携带 model。配置全部进入 `extractorSpecHash`：

```text
alphaThreshold
colorBins
silhouetteGridSize
```

Extractor 对每个 M3 Frame Result 执行：

- 重新验证 Frame Result Hash；
- 从最终 Anchored Asset 对应 CAS 读取 RGBA PNG；
- 复核 SHA-256、RGBA、width、height 与 Alpha mode；
- 从真实 Alpha 像素计算 normalized `subjectBounds`；
- 从可见像素计算按 Alpha 加权的 RGB histogram，作为确定性 appearance/identity proxy；
- 从前景 bounds、填充率和上下半区权重计算 body proportions；
- 从完整 canonical canvas 计算固定网格 Alpha occupancy，形成 silhouette embedding。

Feature 的 `frameIndex / sourceContentHash / canvas` 继续由现有 `DeterministicPoseClipContinuityEvaluator` 与 Frame Result 最终 Asset 绑定。Evaluator 本身未重写，现有 Identity、Scale、Canvas、Body、Foot Contact、Anchor Movement、Silhouette 和 Loop Closure 逻辑直接消费真实像素特征。

## Fail-closed Gate

- 任一 M4 Result / Artifact Hash 脱钩时 Bridge 拒绝组装；
- QA Evaluator identity 必须与带 Hash QA Spec 一致；
- Processor Spec stage 必须严格为 matted → normalized → anchored；
- Anchored CAS bytes 与 Asset content hash 不一致时 Feature Extraction 失败；
- Frame Result Hash 脱钩时不得读取 CAS 或生成 Feature；
- RGBA 无前景、尺寸不一致或配置包含未知字段时失败。

## 当前边界

RGB histogram 是真实像素派生的 appearance proxy，不是人物 Re-ID 模型；body proportions 与 silhouette grid 也是确定性几何特征，还没有经过真实人物/动物数据集阈值校准。screen-space Foot Anchor 仍不等于 anatomical left/right。因而当前能够完成真实内部 E2E 和发现问题，但不能仅凭 fixture 阈值宣布 Production Ready。

本提交不实现 Persistent Feature Cache、神经网络 Identity / Pose 模型、人工 Anchor Correction、Production Profile 自动批准、真实 ComfyUI GPU 四帧运行或 Paper Engine 接线。
