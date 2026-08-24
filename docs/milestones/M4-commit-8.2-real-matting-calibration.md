# M4 Commit 8.2 — Real Matting Calibration

状态：**Automated Candidate Gate PASS；Visual/Production Approval PENDING**

本提交不重新运行 GPU，也不修改 M4 Commit 7 Frozen Baseline。四张真实 Raw CAS 作为固定输入，Baseline `chroma-key-matting@1.0.0` 与 Candidate `chroma-key-matting@1.1.0` 并存比较。

## Candidate 算法

`chroma-key-matting@1.1.0` 在原 RGB Chroma Key 后增加：

```text
Initial Chroma Alpha
        ↓
Border-connected Green Flood Fill
        ↓
Primary Foreground Component
        ↓
Near-subject Detail Retention
        ↓
Surviving Edge Spill Suppression
```

Candidate Spec：

```text
experiments/comfyui-feasibility/calibration/chroma-key-matting-border-candidate-v1.json
```

Processor 版本从 `1.0.0` 升到 `1.1.0`，因为 Border Cleanup、Component Retention 和 Edge Spill Suppression 都是新的算法能力，而不是原阈值的修正。

```text
candidateMattingSpecHash
= 3aff6579a10a1b922e592f9990ac71656ee043e6f1c6c91fb66acffeb91df64f
```

Spec Hash 会自然传播到 Stage Cache Key 与 Matting Input Hash；Baseline CAS 和 Evidence 保持 immutable。

## 离线校准入口

先确保 Commit 8.1 Baseline Report 存在，然后执行：

```powershell
pnpm --filter @pose-clip/comfyui-feasibility production:analyze
pnpm --filter @pose-clip/comfyui-feasibility matting:calibrate
```

第二条命令：

1. 验证 Baseline Quality Report 的 `analysisResultHash`；
2. 绑定 Frozen PoseClip/Production Result、四个 Frame Execution Keys 与 Raw Content Hash；
3. 对四份 Raw CAS bytes 重新计算 SHA-256；
4. 离线执行 Candidate Matting、Frozen Normalize 和当前 Anchor；
5. 将 Candidate PNG 发布到独立 Calibration CAS；
6. 输出 Baseline/Candidate Bounds、指标、Anchors、Delta 与确定性 `calibrationResultHash`。

默认报告：

```text
experiments/comfyui-feasibility/reports/matting-calibration.json
```

一次真实四帧校准只需数秒，不执行 Flux Generation。

## Baseline / Candidate

以下均为 Anchored RGBA；比例按百分比显示：

| Frame | Candidate Source Bounds | Foreground Baseline → Candidate | Visible Green Baseline → Candidate | Edge Green Baseline → Candidate | Opaque Green Baseline → Candidate |
| ---: | --- | ---: | ---: | ---: | ---: |
| 0 | `81,81,374,596` | 27.35 → 34.38 | 10.50 → 0.044 | 35.63 → 0 | 1.76 → 0.044 |
| 1 | `98,63,349,642` | 31.24 → 30.27 | 17.37 → 0 | 48.58 → 0 | 1.46 → 0 |
| 2 | `111,51,319,667` | 29.61 → 27.76 | 19.15 → 0 | 59.96 → 0 | 2.18 → 0 |
| 3 | `32,80,426,599` | 35.11 → 30.17 | 15.62 → 0.098 | 32.10 → 0 | 2.53 → 0.098 |

四帧 Source Bounds 都不再等于 `0,0,512,768`。Frame 3 的 Bounds 向左扩展到 `x=32`，包含原图的离散胡须 Alpha，而不是只保留身体主组件。

## 防止指标作弊

Automated Candidate Gate 同时要求：

- 四帧 Bounds 全部脱离完整画布；
- Center/Foot 核心 Anchor 存在；
- Visible、Edge、Opaque Green 每帧都下降；
- 每帧 Foreground Coverage 保持非空；
- Matted Alpha 同时具有 0 与 255；
- Candidate Matting、Normalize、Anchor 和 Result 都具有独立 Hash 身份。

真实图像检查确认：四只兔子的身体、双耳、脚、尾巴和内部水彩纹理仍存在，没有出现身体挖空或整帧透明。黑色细线在黑色透明预览底上可能不可见，但 Frame 3 胡须已进入 Alpha Bounds。

## 下游诊断

Frame 1 的兔子双脚在 Candidate 图像中均存在，但当前 `alpha-geometry-anchor@1.0.1`、`footBandHeight=12` 只生成了右侧 Foot Anchor。原因是清理后的真实双脚最低点高度不同，较高的一只脚不在最底部 12 px band 内。

该问题没有通过放宽 Matting 指标掩盖，也没有在本提交偷改 Anchor：

```text
Matting Candidate Automated Gate  PASS
Bilateral Foot Anchor Diagnostic  Frame 1 PENDING
Visual Approval                   PENDING
Production Profile Integration    PENDING
```

在 Candidate 正式进入 Production Profile 前，应单独校准 Foot Band/双足检测并重新运行 Anchor、Continuity 与 Frame QA。

## Result Identity

当前离线结果：

```text
calibrationResultHash
= c8ca1b24bf3075790e5c0d1ffc09d171d0cf80ddb0822a580159a9e85a8b1bb5
```

该 Hash 绑定 Frozen Source、Baseline Analysis Result、四个 Processor Spec Hash、逐帧 Raw/Candidate Content Hash、Transforms、Anchors、Measurements、Deltas 与 Diagnostics。

## 结论

M4 Commit 8.2 已建立可重复的真实 Matting Candidate，并通过自动化质量 Gate。当前不能写成 Production Approved。Frame 1 的 Anchor 参数校准与真实 Continuity 重放已由 [M4 Commit 8.3 — Bilateral Foot Anchor Calibration](M4-commit-8.3-bilateral-foot-anchor-calibration.md) 完成；Matting/Anchor Candidate 的人工透明背景视觉审批仍然 pending。
