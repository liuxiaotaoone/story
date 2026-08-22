# M4 Commit 7 — Real GPU Production E2E

状态：**Execution Prepared / Environment BLOCKED；Real GPU Gate NOT RUN**

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
pnpm --filter @pose-clip/asset-generation build
pnpm --filter @pose-clip/schemas build
pnpm --filter @pose-clip/comfyui-feasibility production:plan
pnpm --filter @pose-clip/comfyui-feasibility production:e2e
```

默认使用 `http://127.0.0.1:8188`，可通过 `COMFYUI_ENDPOINT` 指向真实 ComfyUI。运行前必须存在：

```text
experiments/asset-feasibility/processed/rabbit/rabbit-reference.png
```

且其 SHA-256 必须与 admission 中的 Reference Hash 一致。脚本先访问 `system_stats` 记录真实设备环境；端点不可用时标记 `BLOCKED` 并退出，不进入 Provider/GPU。

## Run Report

成功运行会保存 `experiments/comfyui-feasibility/reports/production-e2e.json`，包括：

- ComfyUI System Stats、Workflow、模型、Reference、Request、Profile 与 Execution Key identity；
- Preflight、Raw、Matting、Normalize、Anchor、Bridge、Continuity、Assembly 和总耗时；
- 每帧 Raw 生成耗时、Cache、Retry、各阶段 Input/Cache Key；
- 每阶段 Artifact Hash、PNG Content Hash 和尺寸；
- Subject Bounds、Foot/Left/Right/Center Anchors、Alpha Coverage；
- 八项 Continuity Delta、Worst Pair、Diagnostics 与 Evaluation Hash；
- PoseClip Hash、Production Result Hash、Profile Approval、Human Review 和 `productionReady`。

## 当前环境证据

2026-08-22 在当前审查环境执行时：

- `nvidia-smi` 不存在；历史目标设备为 Intel Arc XPU，本项仅作为环境观察；
- `127.0.0.1:8188` TCP 不可连接；
- `production:e2e` 在 `system_stats` readiness 阶段返回 `BLOCKED`；
- 未调用 Provider、未生成 Raw PNG、未写入任何虚假 GPU PASS 证据。

因此 Commit 7 当前不能判定 PASS。解除阻塞所需的唯一外部动作是启动已安装对应 Workflow 节点与三份 admitted 模型的真实 ComfyUI/XPU 环境，或通过 `COMFYUI_ENDPOINT` 提供可访问的等价服务。随后直接重跑同一命令即可。
