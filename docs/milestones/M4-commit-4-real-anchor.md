# M4 Commit 4 — Real Anchor

状态：**Commit 4.1 Contract / Evidence / Geometry / Identity / Cache / Publication Gate PASS；Overall Candidate**

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

当前确定性实现为 `alpha-geometry-anchor@1.0.1`，属于 algorithmic processor，不携带 model。完整可变配置进入 `PoseFrameProcessorSpec.config`：

```text
alphaThreshold
footBandHeight
```

Processor 从 Alpha 大于等于 `alphaThreshold` 的像素形成前景集合：

- `center` 是前景 pixel bounds 的几何中心；
- 脚部候选限定在前景底部 `footBandHeight` 行；
- 候选按前景水平中心分成左右两侧；
- `foot` 独立取整个 foot band 最深支撑行的像素中心均值；
- screen-left / screen-right 候选存在时，`leftFoot` / `rightFoot` 分别取对应侧最深支撑行的像素中心均值；
- 某一侧没有候选时，对应 Foot Anchor 保持 `undefined`，不得用另一侧或全局 `foot` 伪造。

Anchor 坐标按完整 canonical canvas 的 width / height 归一化。脚部 y 使用支撑像素的底边，因此可以直接进入现有 GroundLock 的本地像素换算。

Anchor 阶段不修改图像：Processor 输出必须与 Normalized PNG bytes 完全一致。Anchored Asset 保持相同 `contentHash`、画布、RGBA 与 Alpha 数据，并把 `xxx.normalized` 严格恢复为 FrameSpec 的最终公开 Asset ID `xxx`；非 `.normalized` 输入身份直接失败。这样四个 M4 Artifact 可以原样进入 M3 Frozen `PoseClipFrameProductionResult`。

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
- Anchor 输出必须满足 `PoseAnchorsSchema`，并覆盖对应 FrameSpec 的全部 `requiredAnchors`；单侧候选缺失不得制造另一侧 Anchor；
- Anchor Processor 不得修改任何 PNG bytes、画布或 Alpha；
- Cache HIT 必须重新验证 bytes Hash、画布、Alpha mode、Anchor Schema 与 required anchors；
- 四帧上游 Evidence、CAS bytes、Anchor 输出和结构全部验证后，才允许第一次 Anchored CAS 发布；
- CAS 发布后，Anchored Asset / Artifact / Frame / Result 形成独立 Hash 链并执行最终完整性校验。

## 当前边界

Alpha Geometry Anchor 是真实像素级、确定性的 silhouette detector，但不是人体/动物关键点模型。当前稳定输出 `center / foot`，并只在对应画面侧存在支撑候选时输出 `leftFoot / rightFoot`；这里的 left/right 是 screen-space 分区，不声明解剖学左右脚语义。要求缺失的 Foot、hand、head 或 auxiliary anchor 的请求会 fail-closed。真实人物/动物素材的足部视觉准确度、遮挡处理和身体左右语义仍需 GPU 资产视觉 QA、关键点模型或人工校正。

Commit 4.1 的 Production Closure 详见 [Anchor Production Closure](M4-commit-4.1-anchor-production-closure.md)。正式 Frame Result Bridge 与真实 RGBA Continuity Feature 已由 [M4 Commit 5](M4-commit-5-production-bridge-real-continuity.md) 接续，不反向进入 Anchor。本提交本身不实现 PoseClip Assembly、Persistent Cache 或 Paper Engine 接线。
