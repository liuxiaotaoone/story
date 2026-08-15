# M3 Commit 2 — ComfyUI Feasibility

状态：**PASS / Frozen**（Commit 2 + Commit 2.1）

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

Commit 2.1 Reliability Gate 使用：

```powershell
pnpm --filter @pose-clip/comfyui-feasibility reliability
```

Gate 要求五个任务严格串行、每项只尝试一次、每项完成后显式释放资源、五张 PNG Content Hash 全部唯一。冻结证据见 `frozen/reliability-gate-manifest.json`。该 Gate 冻结 512×768 / 6-step 的本地可靠性，不冻结 Production Resolution 或生成吞吐。
