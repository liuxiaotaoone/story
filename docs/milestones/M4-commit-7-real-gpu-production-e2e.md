# M4 Commit 7 — Real GPU Production E2E

状态：**Real GPU Gate PASS；Production Approval PENDING**

M4 Commit 6 的 Trusted Production Orchestrator 已通过合同与内部 E2E。Commit 7 不再增加 Fixture 或图像算法，唯一目标是以真实 ComfyUI Workflow、Checkpoint、Reference Image 和 GPU 执行完整四帧生产链，并留存可校准的 Run Report。

## 已冻结的真实运行输入

`production-e2e-admission.json` 固定接纳：

- `flux2-klein-reference-single-frame-v1` Workflow 原始 bytes Hash；
- Intel Arc 130T 模型目录文件 Hash；
- Rabbit Reference Image bytes Hash；
- 四帧 Idle Production Request Hash；
- Pending Production Profile Hash；
- 四个 Frozen M3 Frame Execution Keys。

Profile 使用 `approval=pending`，运行时 Human Review 固定为 `pending`。宽松 Continuity Threshold 只用于首次真实数据采集，不构成 Production Approval，也不能让调用方通过普通参数伪造人审通过。

## 正式运行入口

```powershell
pnpm --filter @pose-clip/schemas build
pnpm --filter @pose-clip/asset-generation build
pnpm --filter @pose-clip/comfyui-feasibility production:plan
pnpm --filter @pose-clip/comfyui-feasibility production:e2e
```

在没有现成 `dist` 的 clean workspace 中必须先构建 Schemas，再构建依赖它的 Asset Generation；也可以直接先执行 `pnpm build`。

默认使用 `http://127.0.0.1:8188`。运行前必须设置本机模型根目录，例如：

```powershell
$env:COMFYUI_MODEL_ROOT = 'D:\ComfyUI\models'
```

脚本以 8 MiB buffer 流式计算以下真实文件 SHA-256：

```text
diffusion_models/flux-2-klein-4b-fp8.safetensors
text_encoders/qwen_3_4b_fp4_flux2.safetensors
vae/flux2-vae.safetensors
```

只有三个 Runtime Hash 与 admitted Model Catalog 完全相等才继续访问 `system_stats`。Hash 不一致时返回 `REAL_GPU_MODEL_HASH_MISMATCH`，Provider 调用保持为零；Run Report 记录 modelId、相对路径、文件大小、admitted/runtime Hash 与 verified 状态。

本地文件校验只能证明 loopback ComfyUI 的模型身份。因此当前 `COMFYUI_ENDPOINT` 只接纳 localhost/loopback；远程 Endpoint 在可信 Worker Model Manifest 建立前返回 `REAL_GPU_REMOTE_MODEL_EVIDENCE_UNSUPPORTED`。

运行前还必须存在：

```text
experiments/asset-feasibility/processed/rabbit/rabbit-reference.png
```

且其 SHA-256 必须与 admission 中的 Reference Hash 一致。脚本先校验 Runtime Model bytes，再访问 `system_stats` 记录真实设备环境；任一步不可用时标记 `BLOCKED` 并退出，不进入 Provider/GPU。

## Run Report

每次运行都会保存 `experiments/comfyui-feasibility/reports/production-e2e.json`。PASS 报告包括：

- ComfyUI System Stats、Workflow、模型、Reference、Request、Profile 与 Execution Key identity；
- Preflight、Raw、Matting、Normalize、Anchor、Bridge、Continuity、Assembly 和总耗时；
- 每帧 Raw 生成耗时、Cache、Retry、各阶段 Input/Cache Key；
- 每阶段 Artifact Hash、PNG Content Hash 和尺寸；
- Subject Bounds、Foot/Left/Right/Center Anchors、Alpha Coverage；
- 八项 Continuity Delta、Worst Pair、Diagnostics 与 Evaluation Hash；
- PoseClip Hash、Production Result Hash、Profile Approval、Human Review 和 `productionReady`。

FAIL/BLOCKED 报告同样保留已经建立的 Evidence：

- Runtime Model admitted/runtime Hash 与 verified 状态；
- 已成功读取的 ComfyUI `system_stats`，即使后续 GPU 执行失败也不会丢失；
- 原始错误名称、错误码与消息；
- 结构化 `failure.phase/frameIndex/provider/promptId/nodeId/reason`。不能可靠判断阶段时使用 `phase=unknown`，不会编造阶段信息。

## 当前真实运行证据

2026-08-24 使用同一份 Frozen Admission 在本机完成真实运行：

- ComfyUI `0.27.1`、PyTorch `2.13.0+xpu`；
- Device：`xpu:0 Intel(R) Arc(TM) 130T GPU (16GB)`；
- 启动参数：`--disable-smart-memory --novram --cpu-vae --deterministic --cache-none --preview-method none`；
- 三份 Runtime Model 文件重新计算 SHA-256，并与 Frozen Admission 完全一致；
- Workflow、Reference、Request、Pending Profile 与四个 Frame Execution Keys 全部通过身份校验；
- 四帧 512×768 / 6-step Raw PNG 全部完成，每帧只提交一次并发布到 CAS；
- Matting、Normalize、Anchor、Bridge、Continuity 与 Assembly 全部完成；
- Continuity Collection Gate 为 `passed`、`automatedReady=true`、Diagnostics 为空；
- 总耗时 `1,046,367 ms`，其中 Raw Generation `1,042,341 ms`；
- `poseClipHash=ffcd4ab58415adc29a7e62f6bf1562af8b567bd151216e495bc0b4463258b727`；
- `resultHash=720c00cac3c16f073e925562b348e60ab5cac9600666b35dba5748b2d660f7c1`；
- 最终 `/free` 成功，`resourceRelease.status=PASS`，队列归零且设备显存完全释放。

因此 M4 Commit 7 的 Real GPU Production E2E Gate 可以判定 **PASS**。这只证明 Frozen 输入、真实 GPU 执行、完整生产链与 Evidence/Resource Lifecycle 闭环，不构成视觉资产生产审批。Profile Approval 与 Human Review 仍为 `pending`，所以 `productionReady=false` 是预期结果。

首批真实 RGBA 帧暴露了绿幕纹理残留、边缘 Green Spill 以及帧间姿态/身份波动。当前 Continuity Threshold 是首次数据采集用的宽松值，下一阶段需要基于这批 Evidence 校准 Matting 与 Continuity，并进行人工视觉审查。

## GPU 调优历史

2026-08-22 的早期运行已完成 Runtime Model Evidence 和真实 GPU Submission，但在连续帧 Sampler 阶段出现 `UR_RESULT_ERROR_OUT_OF_DEVICE_MEMORY`。随后 `--cache-none` 配置仍在第二帧触发 `UR_RESULT_ERROR_OUT_OF_RESOURCES`。最终使用 `--novram` 解决逐帧设备内存累积，且没有修改 Workflow、分辨率、Prompt、Seed、模型或 Frozen Admission，因此 PASS 与原 v1 Identity 完全可比。
