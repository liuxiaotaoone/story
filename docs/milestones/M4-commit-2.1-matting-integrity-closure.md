# M4 Commit 2.1 — Matting Integrity Closure

状态：**Contract / Integrity Gate PASS；Overall Candidate**

本次只关闭 M4 Commit 2 的两个 P1，不扩展 Chroma Key 算法，也不提前进入 Normalize。

## RGB+tRNS fail-closed

`inspectPng()` 会正确把 RGB+tRNS 识别为带 transparency 的 PNG，但当前 Matting decoder 只实现 opaque RGB 与原生 RGBA。此前 RGB decode 分支无条件补 `alpha=255`，会静默丢失 tRNS transparency。

现在支持边界固定为：

```text
8-bit non-interlaced opaque RGB → PASS
8-bit non-interlaced RGBA       → PASS
RGB+tRNS                        → explicit FAIL
palette / grayscale / interlace → explicit FAIL
```

Codec 测试使用两个同为 2×1 green/red 的合法 PNG：opaque RGB 正确解码为 Alpha 255；RGB+tRNS 仍由 `inspectPng()` 识别为 `alphaMode=straight`，但 Matting decoder 明确抛出 `Matting does not support RGB PNG with tRNS transparency`。因此不再存在 metadata 与 pixel decode 对 transparency 的静默分歧。

## Algorithmic Matting identity

Chroma Key 没有 weights、binary 或 profile manifest，不再伪造不可重算的 `model.contentHash`。它的全部可变输出身份已经由以下字段完整覆盖：

```text
processor.name = chroma-key-matting
processor.version = 1.0.0
config = keyColor + thresholds + spillSuppression
→ processorSpecHash
```

通用 `PoseFrameProcessorSpec.model` 继续保持 M3 Frozen 的 optional 合同：

- algorithmic processor 可以不带 model；
- model-backed processor 必须由自身实现要求并验证真实 `modelId/contentHash`；
- `ChromaKeyPoseFrameMattingProcessor` 明确拒绝携带 model 的 Spec，防止把任意 Hash 重新包装成 Chroma Key model evidence；
- no-model Matted Asset provenance 不写入 `modelId`，Evidence 与实际实现一致。

Stage Cache 和 Evidence identity 不变：

```text
rawAsset.contentHash + processorSpecHash
→ Stage Cache Key

rawArtifact.outputHash + processorSpecHash
→ mattingInputHash
```

## Gate 边界

本次 Gate 证明 Matting 的合同、Evidence、Cache、PNG 解码边界和像素输出结构成立，不声称真实资产的 Matting 视觉质量已经通过。Alpha coverage、foreground ratio、edge refinement、green spill score、HSV/Lab 升级和 AI segmentation fallback 留给真实数据 QA/Hardening，不阻塞 M4 Commit 3 — Real Normalize。
