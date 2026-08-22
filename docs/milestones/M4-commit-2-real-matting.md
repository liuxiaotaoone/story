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

当前 Matting 是面向 M3/M4 绿色背景生成工作流的确定性 Chroma Key 实现，不是测试用 PNG metadata 占位器。它解码 ComfyUI `SaveImage` 常用的 8-bit、non-interlaced RGB/RGBA PNG，逐像素计算 Alpha、执行可配置 spill suppression，并重新编码为 RGBA PNG。

## Evidence 与 Cache Identity

Processor Spec 固定绑定：

```text
processor.name/version
+ model.id/contentHash
+ config(keyColor / thresholds / spillSuppression)
→ processorSpecHash
```

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
- Processor 的 stage/name/version 必须与带 Hash 的 Spec 一致，Spec 必须携带 model identity/contentHash；
- 输出必须是完整可解码的 RGBA PNG，且 width/height 与 Raw 一致；
- Alpha 不得全 255，也不得全 0；
- Matting Processor 不得夹带 Anchor 输出；
- 四帧输出全部验证完成后才允许第一次 Matted CAS 发布；
- Raw Result/Evidence 只读，Matted Result 形成独立的 Artifact/Frame/Result Hash 链。

回归测试覆盖真实像素 Matting、RGBA/Alpha 读取、Cache HIT、config 失效范围、Raw CAS bytes 篡改、全不透明输出冒充 Matting，以及第四帧失败时 Matted CAS 仍为空。

## 当前边界

本提交不实现 Normalize、Anchor、Continuity Feature、Production Profile Admission 或 Paper Engine 播放。Chroma Key model identity 是当前可执行 Matting profile；未来替换为神经网络 Matting 时必须使用新的 model/contentHash 与 Processor version，不能在现有 Spec 身份下静默改变输出。

Raw 四帧的真实 ComfyUI/GPU E2E 仍需在可访问生产环境执行，因此整个 M4 保持 Candidate；本地 Contract/Integrity/Pixel Matting Gate 已可执行。下一提交进入 M4 Commit 3 — Real Normalize。
