# M3 Commit 3.1.2 — Frame Production Pipeline / Result Evidence & Generation Resume Closure

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

`frameExecutionKey` 同时进入 `PoseClipFrameProductionResult` Payload 与 `resultHash`。因此 Processor、QA 或 Executor 身份变化时，即使最终 PNG 与 QA 状态碰巧相同，Production Evidence 的身份仍然不同。Result Cache 命中时还会校验结果内的 Key 与当前执行 Key 完全一致。

## Generation Resume Contract

ComfyUI Provider 暴露分阶段执行合同：

```text
submit(request)
→ promptId + generationInputHash
→ Generation Resume Cache
→ collect(request, same submission)
→ Poll / Download / Verify
```

Submit 成功后，Poll、History、Timeout 或 Download 的显式瞬态错误只重试 `collect`，不会再次调用 `POST /prompt`。未完成任务的 submission 会保留在可替换的 Resume Cache 中，后续 Executor 可以继续收集同一个 promptId；生成产物写入 Generation Cache 后才清除 Resume Record。普通非分阶段 Provider 继续使用兼容的 `generate()` 路径。

如果网络在 `POST /prompt` 已被服务端接收、但客户端尚未获得 promptId 时断开，仍属于未知提交状态；按 `generationInputHash` 查询 ComfyUI Queue/History 的服务端恢复能力留给后续持久化 Worker，不在 3.1.2 内伪造保证。

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
- QA 配置变化但 QA 输出相同：`frameExecutionKey` 与 `resultHash` 都必须改变；
- History 或 `/view` 首次返回 503：继续使用原 promptId，`POST /prompt` 总调用次数保持 1；
- Collect 中断后使用共享 Resume Cache 再执行：恢复原 promptId，不提交第二个 Job；
- Processor 首次修改输入 bytes 并瞬时失败：第二次仍收到未经修改的原始 bytes。

## Retry Contract

重试不再依赖“不是某一种错误就重试”的否定判断，而只接受显式瞬态类型：

- `AssetGenerationTransientError`；
- `PoseFrameProcessorTransientError`。

`AssetGenerationIntegrityError`、Processor Contract Error、Execution Integrity Error 与未分类异常均 fail-fast。回归测试固定 Workflow Hash mismatch 和 Reference Hash mismatch 只调用 Provider 一次，HTTP 503 首次失败则第二次重试成功。

Processor 每次 Attempt 都收到 `bytes.slice()` 与 `structuredClone(spec)`；QA Evaluator 同样收到 FrameJob、Artifacts、Anchors 与 Spec 的工作副本。执行插件无法通过修改输入污染后续重试或缓存身份。

## 当前边界

本版本的 Cache 是可替换接口加内存 Reference 实现；Local CAS 已实际写入 `<contentHash>.png`。持久化 Result/Resume Cache、未知 Submit 状态恢复、CAS 崩溃恢复、并发调度和运行时模型文件 Hash 复核不在 3.1.2 范围内。

下一阶段 M3 Commit 3.2 实现跨帧 Continuity QA，包括 Identity、Scale、Canvas、Body Proportion、Foot Contact、Anchor Movement、Silhouette 与 Loop Closure。
