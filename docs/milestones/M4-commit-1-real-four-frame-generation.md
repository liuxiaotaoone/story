# M4 Commit 1 — Real Four-Frame Generation

状态：**Implemented / Candidate**

M4 Commit 1.1.1 的 Raw Generation Integrity Closure 已补齐：PNG 必须通过完整 chunk/CRC/IDAT 解压与 scanline 结构校验；Raw Evidence 绑定 `artifact.inputHash`、`asset.provenance.inputHash` 与 producer；M4 Raw Generation Request 与 Raw Result 固定为四帧，通用 `PoseClipProductionRequest` 保持 M3 Frozen 的 2+ 帧合同。ComfyUI Provider 只返回下载到的 bytes，不在 Executor 验证前写入正式 CAS；正式发布仍由 Raw Executor 完成。

本提交是 M4 的第一步，只负责：

```text
PoseClipProductionRequest → M4 Raw Generation Request Gate (FrameSpec × 4)
→ ImageGenerationProvider / ComfyUiProvider
→ Raw PNG bytes
→ Local CAS
→ ordered Raw Generation Result
```

不实现 Matting、Normalize、Anchor、Continuity Feature、Production Profile Admission 或 Paper Engine 播放；M3 的 Frozen Frame Production Pipeline 不被改写。

## Raw Contract

`PoseClipRawFrameGenerationResult` 绑定：

- `frameIndex`、`frameJobHash`、`frameSpecHash`；
- `generationInputHash`；
- stage=`raw` 的 content-addressed Artifact；
- Artifact `outputHash` 与 Frame Result `resultHash`。

`PoseClipRawGenerationResult` 再绑定 Production Request Hash、有序四帧结果和 Raw Executor Producer。Integrity 校验会拒绝非连续帧序、Detached FrameJob、错误 Asset ID/Kind、错误 Raw inputHash、Artifact Hash 或顶层 Result Hash。

## Executor

`PoseClipRawGenerationExecutor` 按 FrameIndex 顺序执行每个 FrameJob：

- 复用 Generation Cache 与 Resume Cache；
- Resumable Provider 使用 `submit → collect`，沿用 M3 的 ambiguous submit fail-closed 语义；
- 验证真实 PNG bytes、尺寸、Alpha、Asset Provenance 和 Content Hash；
- 写入 Local CAS 后再生成 Raw Evidence；
- Generation transient 只在当前 Frame 内有限重试，单帧失败不会伪造完整四帧结果。

当前测试使用 Fixture PNG 和 ComfyUI mock transport 验证合同与请求顺序。真实 ComfyUI、参考角色、工作流模型和 GPU 生成需要在 M4 的可访问运行环境执行；本提交不把 Fixture 视觉质量当作生产结论。

## Next Boundary

M4 Commit 2 接入真实 Matting，将 Raw CAS 资产转换为 Matted RGBA，并保留本提交的 Raw Evidence 不变。
