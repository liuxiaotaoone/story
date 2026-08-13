# M3 Commit 2 — ComfyUI Feasibility

状态：**Implemented / Awaiting Real Generation Gate**

本实验只验证以下单向链路：

```text
ActionGenerationRequest
→ ComfyUI API Workflow
→ Flux.2 PNG
→ local byte SHA-256
→ VisualAssetRecord
```

它不生成 Action Package，不修改 Compiler、Timeline、Paper Engine 或 Renderer。

## 本机基线

- ComfyUI：`0.27.1`
- PyTorch：`2.13.0+xpu`
- Device：Intel Arc 130T 16GB
- Diffusion Model：`flux-2-klein-4b-fp8.safetensors`
- Text Encoder：`qwen_3_4b_fp4_flux2.safetensors`
- VAE：`flux2-vae.safetensors`

运行：

```powershell
pnpm --filter @pose-clip/asset-generation build
pnpm --filter @pose-clip/schemas build
pnpm --filter @pose-clip/comfyui-feasibility generate
```

ComfyUI 默认地址为 `http://127.0.0.1:8188`，可用 `COMFYUI_ENDPOINT` 覆盖。Workflow 文件按原始 bytes 计算 SHA-256；返回图片同样由 Provider 读取真实 bytes 后计算 `AssetRecord.contentHash`。

若调用进程在 ComfyUI 完成前中断，可设置 `COMFYUI_PROMPT_ID`，从 History 收集已完成任务。收集时会验证 History 中的 `client_id` 与 Generation Request `inputHash` 绑定一致，不能把其它任务的图片冒充为当前产物。
