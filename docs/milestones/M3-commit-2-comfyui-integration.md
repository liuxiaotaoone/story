# M3 Commit 2 — Asset Generation Provider / ComfyUI Integration

状态：**PASS / Frozen**（Commit 2 Provider Integration + Commit 2.1 Provider Hardening）

## 冻结边界

本提交没有修改 Compiler、Canonical Timeline、Paper Engine、Pixi Renderer 或 Action Package v1。新增链路为：

```text
ActionGenerationRequest
→ ImageGenerationProvider
→ ComfyUiProvider
→ ComfyUI API Workflow
→ PNG bytes
→ local SHA-256
→ VisualAssetRecord
```

`ActionGenerationRequest.inputHash` 使用 `canonicalHash('action-generation-request-v1', payload)`，绑定：

- Workflow ID 与 Workflow 文件字节 Hash
- Provider，以及 Diffusion Model / Text Encoder / VAE 三类 Runtime Model 的 ID 与真实 Content Hash
- Prompt / Negative Prompt
- Seed
- Reference Asset ID 与真实 Content Hash
- Output Asset ID / Kind

Provider 会再次验证 Request Hash、Workflow bytes Hash 与 Reference bytes Hash。任何一项漂移均在向 ComfyUI 排队前失败。ComfyUI 返回的 Hash、文件名或模型声明不作为资产真实性依据；`AssetRecord.contentHash` 始终来自本系统读取的最终 PNG bytes。

Commit 2.1 进一步冻结：

- Output Contract 显式声明 `nodeId` 与 `expectedCount=1`；Provider 只读取该节点，缺失或多图均报 `GENERATION_OUTPUT_COUNT_MISMATCH`。
- Reference 上传名固定为 `<safeAssetId>-<contentHash前16位>.png`，相同内容可安全复用，不同内容永不覆盖同名输入。
- Runtime Model Catalog 已独立读取三个本地模型文件 bytes 并记录 SHA-256；三种角色缺一不可。
- ComfyUI `extra_data.generationRequestHash` 保存完整 64 字符 Hash，Resume 同时核对完整 `client_id` 和 Request Hash。

## 本机真实 Gate

环境：

- ComfyUI `0.27.1`
- PyTorch `2.13.0+xpu`
- Intel Arc 130T 16GB
- `flux-2-klein-4b-fp8.safetensors`
- `qwen_3_4b_fp4_flux2.safetensors`
- `flux2-vae.safetensors`

输入：现有 `rabbit-reference.png`，ReferenceLatent Workflow，768×1024，20 steps，Seed `20260813`。

结果：

```text
ComfyUI promptId:
4f2e3f31-e959-4b40-8c73-f723d26713b5

Generation Request inputHash:
5fe10871083748411403fc61b6aede5e28f57f8a687e14f72777f586ab79f056

Workflow bytes SHA-256:
75cd7a3cb549c0c70917cf909c394c1b1c35a50294deb2074ee93ee472e295e3

Final PNG bytes SHA-256:
51422c73a6acfd0c6def7267012ac123824d9ce42510db962052da77280e1b24

PNG:
768 × 1024 / opaque / 1,347,667 bytes

Cold execution:
642,988 ms
```

生成结果为完整、左朝向、身份与纸片水彩风格一致的兔子，未裁头、耳或脚；绿色背景符合后续 Matting 输入要求。当前 AssetRecord 保持 `qaStatus=pending`，本提交不冒充资产生产 QA。

## Commit 2.1 Sequential Reliability Gate

初版第一次真实任务成功后，立即重复同一 Reference Workflow 曾在 `VAEEncode` 返回：

```text
UR_RESULT_ERROR_OUT_OF_RESOURCES
```

Commit 2.1 使用 `512×768 / 6 steps / --lowvram / --cpu-vae`，并在每项完成后调用 `/free`：

```text
requiredJobs:          5
completedJobs:         5
attempts per job:      1
automaticRetry:        false
OOM / History errors:  0
unique PNG hashes:     5
resource cleanup:      5 / 5 PASS
total elapsed:         1,487,189 ms
per-image elapsed:     277,428–302,054 ms
```

这一结果冻结“本机低分辨率串行生成可靠性”，不冻结 Production Resolution，也不代表吞吐性能达标。正式多帧生产仍需独立容量计划。

为处理中断恢复，`ComfyUiProvider.collectCompleted()` 只允许收集 History 完整 Request Hash 一致的完成任务。
