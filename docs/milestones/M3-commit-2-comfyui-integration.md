# M3 Commit 2 — Asset Generation Provider / ComfyUI Integration

状态：**Implemented / Awaiting Review**

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
- Provider / Model ID 与可选 Model Hash
- Prompt / Negative Prompt
- Seed
- Reference Asset ID 与真实 Content Hash
- Output Asset ID / Kind

Provider 会再次验证 Request Hash、Workflow bytes Hash 与 Reference bytes Hash。任何一项漂移均在向 ComfyUI 排队前失败。ComfyUI 返回的 Hash、文件名或模型声明不作为资产真实性依据；`AssetRecord.contentHash` 始终来自本系统读取的最终 PNG bytes。

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

## 已知限制

第一次真实任务成功后，立即重复同一 Reference Workflow 曾在 `VAEEncode` 返回：

```text
UR_RESULT_ERROR_OUT_OF_RESOURCES
```

因此当前结论是“本地 ComfyUI + Flux.2 可用，Provider 链路成立”，不是“连续生产可靠性已通过”。后续 Commit 2 hardening 应验证显存释放、串行队列策略与较低 Gate 分辨率；不得通过跳过错误或复用未经绑定的历史输出制造假 PASS。

为处理中断恢复，`ComfyUiProvider.collectCompleted()` 只允许收集 History `client_id` 与 Request `inputHash` 一致的完成任务。
