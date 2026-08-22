# M4 Commit 4 — Real Anchor

状态：**Contract / Evidence / Geometry / Cache / Publication Gate PASS；Overall Candidate**

本提交只回答“Normalized 角色在 canonical canvas 中由哪些确定性点定位”，不执行跨帧 Continuity QA，也不修改 M3 Frozen Contract、Matting 或 Normalize 主链。

```text
ordered Normalization Result × 4
→ Normalized Artifact / CAS bytes revalidation
→ Alpha foreground geometry
→ center / leftFoot / rightFoot / foot
→ required-anchor validation
→ four-frame validation
→ Anchored CAS
→ ordered Anchoring Result / Evidence
```

## Processor 与几何语义

当前确定性实现为 `alpha-geometry-anchor@1.0.0`，属于 algorithmic processor，不携带 model。完整可变配置进入 `PoseFrameProcessorSpec.config`：

```text
alphaThreshold
footBandHeight
```

Processor 从 Alpha 大于等于 `alphaThreshold` 的像素形成前景集合：

- `center` 是前景 pixel bounds 的几何中心；
- 脚部候选限定在前景底部 `footBandHeight` 行；
- 候选按前景水平中心分成左右两侧；
- `leftFoot` / `rightFoot` 分别取各侧最深支撑行的像素中心均值；
- `foot` 是左右脚 Anchor 的精确中点。

Anchor 坐标按完整 canonical canvas 的 width / height 归一化。脚部 y 使用支撑像素的底边，因此可以直接进入现有 GroundLock 的本地像素换算。

Anchor 阶段不修改图像：Processor 输出必须与 Normalized PNG bytes 完全一致。Anchored Asset 使用新的逻辑 Asset ID 和 Evidence，但保持相同 `contentHash`、画布、RGBA 与 Alpha 数据。

## Cache 与 Evidence

M3 Frozen Stage Cache Identity 保持不变：

```text
stage=anchored
+ normalizedAsset.contentHash
+ anchorProcessorSpecHash
→ stageCacheKey
```

审计链独立绑定本次 Normalized Evidence：

```text
normalizedArtifact.outputHash
+ anchorProcessorSpecHash
→ anchorInputHash
→ anchored asset provenance.inputHash

normalizedArtifact.outputHash
→ anchoredArtifact.inputHash
→ anchoredArtifact.outputHash
→ anchoredFrame.resultHash
→ anchoringResult.resultHash
```

相同 Normalized bytes 可以复用 Anchor 计算缓存；如果上游 Evidence 变化，则会形成新的 `anchorInputHash` 和 Anchored Evidence。修改 Alpha 阈值、foot band 或 Processor identity 只使 Anchor Stage MISS，不反向失效 Raw、Matting 或 Normalize。

## Integrity / Publication Gate

Executor 强制执行：

- 重新验证 Raw → Matted → Normalized 完整 Result / Artifact Hash 链；
- 从 Normalized CAS 重新读取 bytes，并复核 SHA-256、RGBA、尺寸和非空前景；
- Processor stage/name/version 与带 Hash Spec 完全一致；
- Algorithmic Processor 禁止伪造 model identity；
- Anchor 输出必须满足 `PoseAnchorsSchema`，并覆盖对应 FrameSpec 的全部 `requiredAnchors`；
- Anchor Processor 不得修改任何 PNG bytes、画布或 Alpha；
- Cache HIT 必须重新验证 bytes Hash、画布、Alpha mode、Anchor Schema 与 required anchors；
- 四帧上游 Evidence、CAS bytes、Anchor 输出和结构全部验证后，才允许第一次 Anchored CAS 发布；
- CAS 发布后，Anchored Asset / Artifact / Frame / Result 形成独立 Hash 链并执行最终完整性校验。

## 当前边界

Alpha Geometry Anchor 是真实像素级、确定性的 silhouette detector，但不是人体/动物关键点模型。当前稳定输出 `center / foot / leftFoot / rightFoot`；要求 hand、head 或 auxiliary anchor 的请求会 fail-closed，不会伪造语义点。真实人物/动物素材的足部视觉准确度、遮挡处理和左右肢体语义仍需 GPU 资产视觉 QA。

本提交不实现 Continuity Feature、Anchor Movement QA、Foot Contact QA、PoseClip Assembly、Persistent Cache 或 Paper Engine 接线；这些留给后续独立提交。
