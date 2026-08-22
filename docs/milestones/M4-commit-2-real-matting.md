# M4 Commit 2 — Real Matting

状态：**Implemented / Candidate**

本提交停止扩展 Raw Generation，在不修改 M3 Frozen Production Contract 的前提下接入可执行的四帧 Matting：

```text
ordered Raw Generation Result
→ Raw Artifact / CAS bytes revalidation
→ ChromaKeyPoseFrameMattingProcessor
→ complete RGBA PNG validation
→ Matted CAS
→ ordered Matting Result / Evidence
```

当前 Matting 是面向 M3/M4 绿色背景生成工作流的确定性 Chroma Key 实现，不是测试用 PNG metadata 占位器。它解码 ComfyUI `SaveImage` 常用的 8-bit、non-interlaced opaque RGB/RGBA PNG，逐像素计算 Alpha、执行可配置 spill suppression，并重新编码为 RGBA PNG。RGB+tRNS 当前不属于生产需求，明确 fail-closed，避免静默丢失 transparency。

## Evidence 与 Cache Identity

Processor Spec 固定绑定：

```text
processor.name/version
+ config(keyColor / thresholds / spillSuppression)
+ model.id/contentHash（仅 model-backed processor）
→ processorSpecHash
```

Chroma Key 是 algorithmic processor，不携带 model。未来 BiRefNet、RMBG、MODNet 等 model-backed processor 由各自实现强制并验证 `model.id/contentHash`；通用 Matting Contract 保持 M3 Frozen 的 optional model 语义。

每帧 Evidence 继续连接 Raw 链：

```text
rawArtifact.outputHash + processorSpecHash
→ mattingInputHash
→ matted asset provenance.inputHash

rawArtifact.outputHash
→ mattedArtifact.inputHash
→ mattedArtifact.outputHash
→ mattedFrame.resultHash
→ mattingResult.resultHash
```

Stage Cache 继续使用 M3 Frozen 身份，不引入路径、时间或 QA metadata：

```text
rawAsset.contentHash + processorSpecHash + stage=matted
→ pose-frame-stage-cache-v1
```

因此只修改 Matting config/model 会保持 Raw Generation 不变，并使 Matting 及后续 Stage MISS；相同 Raw bytes 即使来自不同审计时间，也仍可安全复用 Matted bytes。

## Integrity Gate

`PoseClipMattingExecutor` 在处理和发布前强制执行：

- Request 与 Raw Result 必须通过 M4 exactly-four-frames Gate；
- 每个输入必须是合法 `stage=raw` Artifact，Raw Artifact/Frame/Result Hash 全部重新验证；
- 从 Raw CAS 读取的 bytes 必须重新匹配 `contentHash`、PNG metadata 与 Asset URI；
- Processor 的 stage/name/version 必须与带 Hash 的 Spec 一致；算法型 Processor 使用 processor/version/config 身份，模型型 Processor 自己强制 model identity/contentHash；
- 输出必须是完整可解码的 RGBA PNG，且 width/height 与 Raw 一致；
- Alpha 不得全 255，也不得全 0；
- Matting Processor 不得夹带 Anchor 输出；
- 四帧输出全部验证完成后才允许第一次 Matted CAS 发布；
- Raw Result/Evidence 只读，Matted Result 形成独立的 Artifact/Frame/Result Hash 链。

回归测试覆盖真实像素 Matting、RGBA/Alpha 读取、Cache HIT、config 失效范围、Raw CAS bytes 篡改、全不透明输出冒充 Matting，以及第四帧失败时 Matted CAS 仍为空。

## 当前边界

本提交不实现 Normalize、Anchor、Continuity Feature、Production Profile Admission 或 Paper Engine 播放。Chroma Key 的算法身份由 processor/version/config 完整定义；未来替换为神经网络 Matting 时必须使用新的 Processor identity 与真实可复核的 model/contentHash，不能在现有 Spec 身份下静默改变输出。

M4 Commit 2.1 已关闭 RGB+tRNS 和 Chroma Key fake model identity 两个完整性问题。Raw 四帧的真实 ComfyUI/GPU E2E 仍需在可访问生产环境执行，因此整个 M4 保持 Candidate；Matting Contract/Integrity/Pixel Output Gate 为 PASS，但不冒充视觉质量 Gate。详见 [M4 Commit 2.1 — Matting Integrity Closure](M4-commit-2.1-matting-integrity-closure.md)。
