# M4 Commit 6 — Trusted Production Orchestrator

状态：**Production Orchestration / Trusted Profile Wiring / Assembly Gate PASS；Overall Candidate**

本提交增加正式 `PoseClipProductionOrchestrator`，将 M4 已完成的四阶段真实资产链、M4 → M3 Bridge、真实 RGBA Continuity 与既有 Production Assembly 串成单一生产入口。各阶段 Processor Spec、Frame QA Spec、Continuity QA Spec、Executor identity 和预期 Frame Execution Keys 均只取自通过完整性校验的 Trusted Production Profile。

```text
PoseClipProductionRequest × 4
             +
Trusted Production Profile
             ↓
Fail-closed Preflight（零 Provider 调用）
             ↓
Raw → Matting → Normalize → Anchor
             ↓
PoseClipFrameProductionBridge
             ↓
RGBA Continuity → Deterministic Evaluator
             ↓
assemblePoseClipProductionResult
             ↓
PoseClipProductionResult
```

## Profile 驱动

调用方不再分别传入可能与最终 Profile 脱钩的 Stage Spec。Orchestrator 从已验证的 Profile 读取：

- `processorSpecs.matted / normalized / anchored`；
- `frameQaSpec`；
- `continuityQaSpec`；
- `executor`；
- `modelHashes`；
- `frameExecutionKeys`。

运行时只注入真实 Provider、CAS、Processor、QA Evaluator 与 Continuity Feature Extractor 实现。它们的 identity 必须与 Profile 声明一致。

## GPU 前 Fail-closed Admission

在构造 Raw Executor 和调用 Provider 之前，Orchestrator 一次性完成：

1. Production Request 完整 Hash 及 M4 exactly-four-frames 合同校验；
2. Production Profile、所有嵌套 Spec 与 `profileHash` 完整性校验；
3. `profileHash === trustedProfileHash`；
4. Profile Executor 必须为 Frozen `pose-frame-production-executor@0.1.2`；
5. 每帧 Provider 必须与注入 Provider identity 一致；
6. 每帧 Generation Runtime Model 必须被 Profile 的 `modelHashes` 接纳；
7. 按 Frozen 公式重算四个 `frameExecutionKey` 并与 Profile 比较；
8. Matting、Normalization、Anchoring、Frame QA、Continuity Evaluator 与 Feature Extractor identity 绑定校验。

因此 untrusted Profile、detached execution key、未接纳模型或错误 Processor 均在 Provider 调用次数仍为零时失败。Profile 的 `approval` 与 Human Review 仍由既有 Assembly 决定最终 `productionReady`；“可信 Hash”与“已批准投产”保持两个独立概念。

## 正式串联与输出证据

预检成功后，Orchestrator 顺序执行现有模块，不复制其算法或合同：

- Raw、Matting、Normalization、Anchoring 各自继续执行 Result / Artifact / CAS 校验；
- Bridge 继续生成 Frozen M3 `PoseClipFrameProductionResult × 4`；
- RGBA Extractor 继续从 Anchored CAS bytes 派生真实 Continuity Features；
- Deterministic Evaluator 使用 Profile 的 Continuity QA Spec；
- Assembly 使用同一 Profile、Trust Anchor、Frame Results 与 Continuity Evaluation 生成最终 Result。

执行返回值同时保留四阶段执行报告、Frame Results、Continuity Evaluation 与最终 Production Result，便于真实 GPU E2E 收集 Cache、Retry 和 Continuity Delta。Generation 与三个 Stage Cache 保存在 Orchestrator 实例中，因此同一实例的重复执行可以复用既有缓存身份。

## 回归 Gate

新增测试使用真实像素实现完成一次四帧单入口内部 E2E：Chroma-key Matting、Premultiplied Bilinear Normalize、Alpha Geometry Anchor、Bridge、RGBA Continuity 和 Assembly 全部执行，并由最终 Production Result Integrity 复核。负向测试证明以下错误不会触发 Provider：

- Profile Trust Hash 不匹配；
- Profile Frame Execution Keys 与 Request/Specs 脱钩；
- Generation Runtime Model 未被 Profile 接纳；
- 注入 Processor identity 与 Profile 不一致。

## 当前边界

本提交完成正式生产编排和 Assembly 串联，但不声称真实 ComfyUI Workflow、Checkpoint 与 GPU 四帧运行已经完成。下一步不再扩充 Fixture 或图像算法，应直接使用一个真实角色和简单动作运行 GPU E2E，记录八项 Continuity Delta，随后基于 Good/Bad Clips 校准阈值，再进入 Paper Engine 与 Renderer/FFmpeg 接线。
