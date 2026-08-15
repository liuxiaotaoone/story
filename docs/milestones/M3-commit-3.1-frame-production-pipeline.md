# M3 Commit 3.1.1 — Frame Production Pipeline / Execution Identity Closure

状态：**PASS / Frozen**

本提交把 M3 Commit 3.0.1 的多帧合同落成可执行的单帧生产流水线。它不修改 Compiler、Timeline、Paper Engine 或 Renderer，也不实现跨帧 Continuity QA。

## 执行链

```text
PoseClipFrameJob
→ ImageGenerationProvider (expectedCount=1)
→ Raw Asset / CAS
→ MattingProcessor
→ Matted Asset / CAS
→ NormalizeProcessor
→ Normalized Asset / CAS
→ AnchorProcessor
→ Anchored Asset / CAS
→ Frame QA
→ PoseClipFrameProductionResult
```

`PoseFrameProductionExecutor` 可以直接消费现有 `ComfyUiProvider`。真实 Provider 输出必须满足：

- `source=generated`；
- `asset.provenance.inputHash === generationRequest.inputHash`；
- PNG bytes、`contentHash`、尺寸、Alpha 与 CAS URI 相互一致；
- 输出 Asset ID 与 Kind 精确匹配 FrameSpec。

这些约束失败时属于永久完整性错误，不进行无意义重试。

## Processor Contract

每个 Matting、Normalize、Anchor Processor 由 `PoseFrameProcessorSpec` 约束：

```text
stage
processor.name/version
model.id/contentHash（可选）
config
↓
processorSpecHash
```

Processor 实现的 `id/version/stage` 必须与 Spec 一致。当前 `DeterministicReferencePoseFrameProcessor` 只用于验证执行、缓存和证据链，不代表生产级图像算法。

Processor 运行时只能读取输入 bytes、对应 `contentHash` 与完整 ProcessorSpec；不能读取 FrameJob、Asset URI、`createdAt` 或 QA Metadata。这样 Processor 的全部可变输入都被 Stage Cache Key 覆盖。实现不得在构造器中保存影响输出但未进入 Spec 的隐藏状态；Reference Anchor Processor 的 anchors 已明确放入 `PoseFrameProcessorSpec.config.anchors`。

Frame QA 同样由 `PoseFrameQaEvaluatorSpec` 约束：

```text
evaluator.name/version
model.id/contentHash（可选）
config
↓
qaEvaluatorSpecHash
```

Evaluator 的实现身份必须与 Spec 一致，所有影响 QA 结果的配置必须进入 Spec。

## 缓存身份

Evidence Record 与 Cache Identity 明确分离。

Generation Cache：

```text
generationInputHash
```

Stage Cache：

```text
inputAsset.contentHash
+ processorSpecHash
↓
pose-frame-stage-cache-v1
```

因此 `createdAt`、QA、文件路径和其他审计字段不污染 Stage Cache。相同输入 bytes 即使来自两次不同时间的生成，也可以命中相同处理缓存。

Frame Result Cache：

```text
frameJobHash
+ ordered processorSpecHashes
+ qaEvaluatorSpecHash
+ executor version
↓
pose-frame-execution-v1
```

这避免 Processor 配置变化后错误复用完整 Frame Result。

## 失效范围

回归测试冻结以下行为：

- 完全相同的第二次执行直接复用完整 Frame Result；
- 只改 Matting threshold：Generation HIT，Matting/Normalize/Anchor MISS；
- 只改 Anchor config：Generation/Matting/Normalize HIT，Anchor MISS；
- 生成时间变化但 PNG bytes 相同：Stage Cache 全部 HIT；
- 四帧中只改 Frame 2：Frame 0、1、3 Result HIT，Frame 2 重新生成和处理；
- 只改 QA config：Generation 与三个 Stage 全部 HIT，仅 Frame Result MISS；
- HTTP 408、429、5xx、网络失败、ComfyUI 超时及显式 Processor transient error 按有限次数重试；
- Workflow Hash、Reference Hash、Provenance、Processor Contract 等完整性错误第一次即 fail-fast；
- Raw Provenance 与 Generation Request 不一致时 fail-fast。

## Retry Contract

重试不再依赖“不是某一种错误就重试”的否定判断，而只接受显式瞬态类型：

- `AssetGenerationTransientError`；
- `PoseFrameProcessorTransientError`。

`AssetGenerationIntegrityError`、Processor Contract Error、Execution Integrity Error 与未分类异常均 fail-fast。回归测试固定 Workflow Hash mismatch 和 Reference Hash mismatch 只调用 Provider 一次，HTTP 503 首次失败则第二次重试成功。

## 当前边界

本版本的 Cache 是可替换接口加内存 Reference 实现；Local CAS 已实际写入 `<contentHash>.png`。持久化 Result Cache / Task Graph、CAS 崩溃恢复、并发调度和运行时模型文件 Hash 复核不在 3.1.1 范围内。

下一阶段 M3 Commit 3.2 实现跨帧 Continuity QA，包括 Identity、Scale、Canvas、Body Proportion、Foot Contact、Anchor Movement、Silhouette 与 Loop Closure。
