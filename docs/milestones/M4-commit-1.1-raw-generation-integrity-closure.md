# M4 Commit 1.1 — Raw Generation Integrity Closure

状态：**Implemented / Candidate**

本提交只关闭 M4 Commit 1 的 Raw Generation 完整性边界，不进入 Matting：

- `PoseClipProductionRequest.frames` 与 `PoseClipRawGenerationResult.frameResults` 固定为四帧；
- Raw Evidence 要求 `artifact.inputHash` 与 `asset.provenance.inputHash` 同时绑定 `generationInputHash`；
- `artifact.producer` 必须与 `asset.provenance.producer` 一致；
- PNG 必须具有完整 IHDR/IDAT/IEND、有效 chunk CRC、可解压的 IDAT 和合法 scanline 结构；
- 截断、CRC 损坏或不可解压 PNG 在 Raw CAS 发布前 fail closed；
- ComfyUI Provider 只返回 bytes 和 metadata，正式文件只由 Executor 验证后写入 CAS。

真实 ComfyUI、模型与 GPU 四帧生成仍需在可访问的生产环境执行，因此状态保持 Candidate。完成该 Gate 后，下一提交可以进入 M4 Commit 2 Real Matting。
