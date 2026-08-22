# M4 Commit 3.1 — Normalize Pixel Integrity Closure

状态：**Contract / Evidence / Pixel Gate PASS；Overall Candidate**

本次只修正 Real Normalize 的 bilinear clamp-to-edge 权重，不修改 Normalize Transform、Cache、Evidence、CAS 发布边界或 M3 Processor Contract。

## 修复

旧实现先 clamp 离散邻点，却继续使用原始连续坐标计算 interpolation fraction。Upscale 左/上边缘时，例如 `x=-0.25`，邻点已被夹到首像素，但 `tx` 仍为 `0.75`，导致边界错误混入下一像素。

现在固定顺序为：

```text
continuous x/y
→ clamp to source bounds
→ floor clamped coordinate
→ select x0/x1/y0/y1
→ fraction = clamped coordinate - floor
→ bilinear weights
```

因此 `x=-0.25` 会得到 `clampedX=0, tx=0`，首个目标像素保持 100% 源首像素。

## Pixel Regression

- 2×1 `RED | BLUE` 放大到 4 像素宽，完整锁定 `RED → 75/25 → 25/75 → BLUE`；
- 2×2 `RED/GREEN/BLUE/WHITE` 放大到 4×4，四个目标角必须精确保持四个源角；
- `opaque RED / transparent BLUE / opaque RED` 放大后，所有可见像素保持纯红，Alpha 正确插值，透明蓝色 RGB 不得污染边缘。

## 保持不变

```text
Stage Cache = mattedAsset.contentHash + normalizeProcessorSpecHash + stage
Evidence    = mattedArtifact.outputHash + normalizeProcessorSpecHash
```

四帧仍在全部像素输出、Transform 与结构验证通过后才开始 Normalized CAS 发布；Normalized Asset/Artifact/Frame/Result Evidence 在发布后形成并执行最终完整性校验。

Canvas pixel-count 上限以及 `plan()/process()` 合并属于后续 Hardening，不阻塞 M4 Commit 4 — Real Anchor。
