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
pnpm --filter @pose-clip/schemas build
pnpm --filter @pose-clip/asset-generation build
pnpm --filter @pose-clip/comfyui-feasibility generate
```

ComfyUI 默认地址为 `http://127.0.0.1:8188`，可用 `COMFYUI_ENDPOINT` 覆盖。Workflow 文件按原始 bytes 计算 SHA-256；返回图片同样由 Provider 读取真实 bytes 后计算 `AssetRecord.contentHash`。

若调用进程在 ComfyUI 完成前中断，可设置 `COMFYUI_PROMPT_ID`，从 History 收集已完成任务。收集时会验证 History 中的 `client_id` 与 Generation Request `inputHash` 绑定一致，不能把其它任务的图片冒充为当前产物。

Commit 2.1 Reliability Gate 使用：

```powershell
pnpm --filter @pose-clip/comfyui-feasibility reliability
```

Gate 要求五个任务严格串行、每项只尝试一次、每项完成后显式释放资源、五张 PNG Content Hash 全部唯一。冻结证据见 `frozen/reliability-gate-manifest.json`。该 Gate 冻结 512×768 / 6-step 的本地可靠性，不冻结 Production Resolution 或生成吞吐。

## M4 Real GPU Production E2E

M4 Commit 7 直接调用 `PoseClipProductionOrchestrator`，以四帧真实 Rabbit Idle Request 串联 Generation、Matting、Normalize、Anchor、Bridge、RGBA Continuity 和 Production Assembly：

```powershell
pnpm --filter @pose-clip/schemas build
pnpm --filter @pose-clip/asset-generation build
pnpm --filter @pose-clip/comfyui-feasibility production:plan
pnpm --filter @pose-clip/comfyui-feasibility production:e2e
```

`production:plan` 只打印当前输入身份，不连接 GPU。`production:e2e` 要求 `COMFYUI_MODEL_ROOT` 指向本机 ComfyUI 的 `models` 目录；它先流式重算三份真实模型文件 Hash，与 admitted Catalog 对齐，再探测 ComfyUI `system_stats`。当前只允许 loopback Endpoint；远程 Worker 在可信 Model Manifest 建立前 fail-closed。输出报告默认位于 `reports/production-e2e.json`，可用 `M4_E2E_REPORT_PATH` 覆盖。

已有 PASS Report 和 CAS 时，可以在不连接 ComfyUI、不重新占用 GPU 的情况下重放质量分析：

```powershell
pnpm --filter @pose-clip/comfyui-feasibility production:analyze
```

该命令输出每帧 Pre-Normalize Bounds、Normalize Transform，以及 Matted/Normalized/Anchored 的 Foreground、Alpha、Soft Edge 与 Green Spill 统计。完全透明像素的 RGB 不计入 Green Spill。

Analyzer 会先读取 `frozen/production-e2e-pass-manifest.json` 和 `frozen/rgba-quality-baseline-spec.json`。只有 PASS Report 的 PoseClip/Result Hash、Admission Identity、四个 Frame Execution Keys 与 16 个 Stage Content Hash 全部匹配 Frozen Manifest，且每份 CAS bytes 重新计算的 SHA-256 等于声明 Content Hash，才允许测量。默认将带 `qualityAnalysisSpecHash` 和 `analysisResultHash` 的确定性报告写入 `reports/production-quality-analysis.json`。

本 Gate 的 Profile 与 Human Review 都固定为 `pending`。首次运行用于采集真实 Continuity Delta，不把宽松采集阈值或普通调用参数冒充为生产审批。

当前状态为 **Real GPU Gate PASS；Production Approval PENDING**。2026-08-24 使用 `--disable-smart-memory --novram --cpu-vae --deterministic --cache-none --preview-method none` 在 Intel Arc 130T XPU 上完成同一份 Frozen Admission：四帧 Raw PNG、Matting、Normalize、Anchor、Bridge、Continuity、Assembly 与最终 `/free` 全部通过，正式报告 `status=PASS`。运行没有修改 Workflow、分辨率、Prompt、Seed、模型或生产合同。

Profile Approval 与 Human Review 仍固定为 `pending`，所以 `productionReady=false` 是预期结果。真实 RGBA 帧仍有绿幕残留及帧间姿态/身份波动；当前宽松 Continuity Threshold 只用于首次数据采集，后续必须进行阈值校准和人工视觉审查，不能把 E2E PASS 冒充为视觉生产批准。

Commit 7 PASS 证据已固化到 `frozen/production-e2e-pass-manifest.json`。首轮质量基线还发现，Matting 残留令四帧 Normalize Source Bounds 都扩张为完整画布；因此应先校准现有 Chroma Key/Foreground 选择，再使用修复后的真实数据制定 Continuity 生产阈值。

M4 Commit 8.2 使用 Frozen Raw CAS 离线校准 Border-connected Candidate，不重新运行 GPU：

```powershell
pnpm --filter @pose-clip/comfyui-feasibility production:analyze
pnpm --filter @pose-clip/comfyui-feasibility matting:calibrate
```

Candidate 为 `chroma-key-matting@1.1.0`，保留 1.0.0 Baseline 不变。报告写入 `reports/matting-calibration.json`，包含 Baseline/Candidate Bounds、Green Spill、Foreground、Anchors、Content Hash 与 Result Hash。Automated Matting Candidate Gate 已通过。

M4 Commit 8.3 使用同一批 Candidate Normalized CAS 校准双侧脚点，不修改全局支撑线：

```powershell
pnpm --filter @pose-clip/comfyui-feasibility anchor:calibrate
```

Candidate 为 `alpha-geometry-anchor@1.1.0`：全局 `foot` 继续使用严格 12 px 底部带，`leftFoot/rightFoot` 分别在主体下方 25% 区域寻找各自最低行。报告写入 `reports/anchor-calibration.json`。四帧双足均存在，Frame 1 新增左脚点；四帧全局 `foot` 和 PNG Content Hash 均未变化。正式 RGBA Continuity 已离线重放，但仍明确使用未校准的 collection thresholds。Matting/Anchor Candidate 尚未进入 Production Profile，Visual Approval 仍为 pending。
