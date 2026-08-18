# M4 Commit 1.1.1 — Raw Contract Boundary Closure

状态：**Implemented / Candidate**

本次只修正两个边界，不进入 Matting：

- 恢复 M3 Frozen `PoseClipProductionRequest` 的 2+ 帧通用合同；M4 通过 `PoseClipRawGenerationRequestSchema` 单独要求 exactly four frames；
- Raw Executor、Raw Result integrity 都使用 M4 四帧 Gate；
- PNG IDAT inflate 除了解压和 scanline 校验，还必须消费全部 compressed bytes；合法 zlib stream 后追加垃圾数据会 fail closed。

这样 M3 的多帧 Production Contract 与 M4 当前四帧生产范围保持分层，未来可在不修改 M3 hash contract 的情况下增加不同帧数的动作类型。

真实 ComfyUI、模型与 GPU 四帧生成仍需在可访问环境执行，因此状态保持 Candidate。完成该 Gate 后，下一提交可以进入 M4 Commit 2 Real Matting。
