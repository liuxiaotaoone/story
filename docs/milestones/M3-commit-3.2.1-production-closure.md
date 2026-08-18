# M3 Commit 3.2.1 — Production Closure

状态：**PASS / Closed by M3 Commit 3.2.2**

本提交只封闭两个 Production Admission 边界，不扩展 3.1 单帧生成、Processor、CAS、Resume Cache 或 3.2 Continuity 指标。

## Ambiguous Submit

`POST /prompt` 的网络传输异常现在抛出 `GENERATION_UNKNOWN_SUBMISSION_STATE`，Executor 将其视为完整性错误并立即停止，不会 blind retry 第二次提交。服务端明确返回的 HTTP 503/408/429/5xx 仍属于可重试 transient；History、轮询和 `/view` 下载继续复用原 promptId 重试。

## Production Profile Admission

最终 `PoseClipProductionResult` 必须携带带 Hash 的 `PoseClipProductionProfile`，其中绑定：

- 三个 Processor Spec、Frame QA Spec 与 Continuity QA Spec；
- Executor 版本；
- 已批准的模型 bytes Hash；
- 有序 Frame Execution Keys；
- Profile approval 状态与 `profileHash`。

Result Integrity 会检查：

- 使用 Request `frameJobHash`、Profile Processor/Frame QA Specs 与 Executor 版本重算每个 `frameExecutionKey`，并要求 Result 与 Profile 中的有序 Key 同时一致；
- Continuity Evaluation 的 Spec Hash 等于 Profile 的 Continuity QA Spec Hash；
- 每个 Frame Generation Runtime Model 被 Profile 接纳；
- 只有 `approval=approved` 才能让 `productionReady=true`。

未批准或不匹配的 Profile 可以保留为审计失败结果，但不能晋级生产资产。Reference Processor/Feature Extractor 仍可用于合同测试，不能绕过 Admission Gate。

## Scope Boundary

本提交不实现 Persistent Result/Resume Cache、并发 single-flight、CAS crash recovery、真实 Matting/Normalize/Anchor、真实视觉特征模型或 Good/Bad 数据集阈值校准。M3 到此冻结，下一阶段进入真实四帧 AI PoseClip E2E。
