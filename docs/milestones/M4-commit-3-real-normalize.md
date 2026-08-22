# M4 Commit 3 — Real Normalize

状态：**Commit 3.1 Contract / Evidence / Pixel Gate PASS；Overall Candidate**

本提交只回答“每帧如何进入统一坐标与画布空间”，不计算 foot/center/leftFoot/rightFoot Anchor，也不修改 M3 Frozen Contract 或 M4 Matting 主链。

```text
ordered Matting Result × 4
→ Matted Artifact / CAS bytes revalidation
→ foreground Alpha bounds
→ deterministic normalization transform
→ premultiplied-alpha bilinear resize
→ canonical RGBA canvas
→ four-frame validation
→ Normalized CAS
→ ordered Normalization Result / Evidence
```

## Processor 与 Transform

`CanonicalCanvasPoseFrameNormalizer` 是 algorithmic processor，不携带 model。全部可变输出参数进入 `PoseFrameProcessorSpec.config`：

```text
canvasWidth / canvasHeight
targetForegroundHeight
maxForegroundWidth
bottomPadding
alphaThreshold
resampling=bilinear-premultiplied
```

Processor 从 Alpha 大于等于 `alphaThreshold` 的像素计算 `sourceBounds`，保持宽高比选择 scale，再生成水平居中、底部带固定 padding 的 `destinationBounds`。Evidence 显式记录：

```text
sourceBounds
destinationBounds
canvas width/height
scale
```

缩放先对连续采样坐标执行 clamp-to-edge，再在 premultiplied-alpha 空间执行双线性插值，最后输出 straight RGBA；这样同时避免边界像素混色错误和透明像素 RGB 污染边缘颜色。

## Cache 与 Evidence

M3 Frozen Stage Cache Identity 保持不变：

```text
stage=normalized
+ mattedAsset.contentHash
+ normalizeProcessorSpecHash
→ stageCacheKey
```

审计链独立绑定本次 Matted Evidence：

```text
mattedArtifact.outputHash
+ normalizeProcessorSpecHash
→ normalizationInputHash
→ normalized asset provenance.inputHash

mattedArtifact.outputHash
→ normalizedArtifact.inputHash
→ normalizedArtifact.outputHash
→ normalizedFrame.resultHash
→ normalizationResult.resultHash
```

因此相同 Matted bytes 可以复用计算缓存，但每个新的上游 Evidence 都形成独立的 Normalized Evidence。

## Integrity / Publication Gate

Executor 强制执行：

- 重新验证 Raw→Matted 完整 Result/Artifact Hash 链；
- 从 Matted CAS 重新读取 bytes，并复核 SHA-256、RGBA、尺寸和非空前景；
- Processor stage/name/version 与带 Hash Spec 完全一致；
- Transform source/destination bounds 必须在各自画布内，destination size 必须与 source×scale 一致；
- 输出必须是指定 canonical canvas 尺寸的完整 RGBA PNG；
- 可见输出不得为空，也不得越出 transform destination bounds；
- Normalize Processor 不得夹带 Anchor；
- 四帧上游 Evidence、CAS bytes、像素输出、Transform 和结构全部验证完成后，才允许第一次 Normalized CAS 发布；
- CAS 发布后，Normalized Asset/Artifact/Frame/Result 形成独立 Hash 链并执行最终 Result Integrity 校验。

回归测试覆盖四帧真实像素缩放、canonical canvas、transform evidence、Stage Cache HIT、config 失效范围、Matted CAS 篡改、第四帧错误输出时零 Normalized CAS 发布，以及 2×1 水平边界、2×2 四角和透明 RGB 防污染三组采样测试。

## 当前边界

M4 Commit 3.1 已关闭 bilinear 边界采样错误，详见 [Normalize Pixel Integrity Closure](M4-commit-3.1-normalize-pixel-integrity-closure.md)。本提交不声明真实人物/动物素材的 scale consistency 或裁切视觉 QA 已通过；这些需要真实 GPU 资产校准。Anchor detection、Anchor Evidence 和 GroundLock 输入留给 M4 Commit 4 — Real Anchor。Persistent Cache、更多 resampler、超大 PNG 限制和视觉质量评分不进入本提交。
