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

人工 Anchor 审核图可重复生成：

```powershell
pnpm --filter @pose-clip/comfyui-feasibility anchor:overlay
```

四张图位于 `review/anchor-overlays/`，红框表示 Subject Bounds，青色 `C`、黄色 `F`、紫色 `L`、蓝色 `R` 分别表示 Center、Global Foot、Screen-left Foot 和 Screen-right Foot。`reports/anchor-overlay-review.json` 绑定四张 Overlay Hash 与上游 Matting/Anchor Calibration Result Hash。自动生成始终保持 `visualApproval=pending`，人工决定不得由脚本代填。

人工审批现已写入独立 `review/candidate-visual-approval.json`。Matting 1.1.0 与 Anchor 1.1.0 获得 Visual Candidate PASS，但 Production Approval 与 Continuity 阈值仍保持未批准。可在不连接 ComfyUI、不重新运行 GPU 的情况下重放 Candidate Production，并生成 Paper Engine RenderPlan：

```powershell
pnpm --filter @pose-clip/comfyui-feasibility production:replay
pnpm --filter @pose-clip/comfyui-feasibility production:render-plan
pnpm --filter @pose-clip/renderer-feasibility candidate:mp4
```

Candidate Profile Hash 为 `5719c0677b1ae7baad7562164fac5929986c1215c5c8a157661721ce7de2c694`。首条真实视频位于 `review/first-real-mp4/rabbit-real-candidate-4s.mp4`：1280×720、30fps、120 帧、4 秒，SHA-256 为 `8589382e51cd836d68df599e632ac0eb1635a850e50d827bada3554ded81aeb6`。该视频用于 GroundLock、Pose Continuity 与 Loop Closure 审查，不代表最终视觉生产批准。

播放节奏可用同一组 Candidate bytes 做单变量对照：

```powershell
pnpm --filter @pose-clip/comfyui-feasibility production:render-plan
pnpm --filter @pose-clip/renderer-feasibility candidate:tempo-comparison
```

该实验输出 0.8s、1.0s、1.2s 三种完整循环，各包含三个循环且不使用 Crossfade。文件位于 `review/tempo-comparison/`，证据位于 `reports/pose-tempo-comparison.json`。这些 RenderPlan 是 review-only Playback Override，不替换 Candidate Production PoseClip。

Human Review 已选择 1.0s 为当前 Rabbit Candidate 默认节奏，证据为 `review/tempo-human-preference.json`。基于该选择可生成 3 帧/100ms、Foot Anchor 对齐的 Crossfade 对照：

```powershell
pnpm --filter @pose-clip/comfyui-feasibility production:transition-plan
pnpm --filter @pose-clip/renderer-feasibility candidate:transition-mp4
```

视频位于 `review/pose-transition/rabbit-real-tempo-1.0s-transition-100ms.mp4`，证据位于 `reports/pose-transition-plan.json` 与 `reports/pose-transition-video.json`。该视频仅用于和 1.0s Hard Cut 做 Human Review；Crossfade 不会修复源图片的身份或轮廓不一致。

100ms Human Review 确认峰值相邻帧变化约下降 35%，但双兔鬼影不可接受，因此不批准为默认值。最后一版 2-frame/66.7ms 对照可通过以下命令生成：

```powershell
pnpm --filter @pose-clip/comfyui-feasibility production:transition-67ms-plan
pnpm --filter @pose-clip/renderer-feasibility candidate:transition-67ms
```

视频为 `review/pose-transition/rabbit-real-tempo-1.0s-transition-67ms.mp4`，只保留一个主要 50/50 混合帧。Transition 参数探索在此收口，后续主线为 ComfyUI Generation Consistency。

67ms 版本已获 Human Candidate Approval，并冻结为 `frozen/rabbit-candidate-animation-profile.json`：30fps、30 帧周期、2 帧 Crossfade、`anchorPolicy=foot`。Profile Hash 为 `27827562aa8232234e2b2e8ff48827c08bd2dee0ae6d3c0603eb63d78d5ec543`。该 Profile 不代表 Production Approval；它只关闭当前 Rabbit Candidate 的 Tempo/Transition 参数探索。
