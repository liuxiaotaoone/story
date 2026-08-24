# M4 Commit 8.3 — Bilateral Foot Anchor Calibration

状态：**Automated Candidate Gate PASS；Visual/Production Approval PENDING**

本提交只关闭 M4 Commit 8.2 暴露的 Frame 1 双足 Anchor 缺口。它不重新运行 GPU，不修改 Commit 7 Frozen Baseline，也不把 Matting Candidate 或新的 Anchor Candidate 写入 Production Profile。

## 算法边界

`alpha-geometry-anchor@1.0.1` 使用同一个固定底部带计算全局支撑点和左右脚：

```text
foreground maxY
      ↓
strict bottom 12 px band
      ├── foot
      ├── leftFoot
      └── rightFoot
```

真实 Frame 1 的左脚最低点高于右脚，未进入这个 12 px band。`alpha-geometry-anchor@1.1.0` 将两个语义拆开：

```text
strict bottom 12 px band ───────────────→ global foot

lower 25% of subject bounds
      ├── screen-left deepest row ──────→ leftFoot
      └── screen-right deepest row ─────→ rightFoot
```

全局 `foot` 仍逐行执行 1.0.1 的严格底部支撑算法；只有左右脚发现使用相对主体高度的搜索区。这样不会通过简单放大 `footBandHeight` 把尾巴、腹部或腿侧误当成全局地面支撑。

Candidate Spec：

```text
experiments/comfyui-feasibility/calibration/alpha-geometry-anchor-bilateral-candidate-v1.json
```

```text
candidateAnchorSpecHash
= 2eafcb0e7ac5fcef84296c34615d429f6fc9ace1efae3c707179b515cb6703b9
```

版本从 `1.0.1` 升为 `1.1.0`，`bilateralFootSearchRatio=0.25` 进入 Processor Spec Hash、Stage Cache Key 和后续 Frame Execution Identity。旧处理器与 Frozen Profile 保持不变。

## 离线校准入口

```powershell
pnpm --filter @pose-clip/comfyui-feasibility matting:calibrate
pnpm --filter @pose-clip/comfyui-feasibility anchor:calibrate
```

`anchor:calibrate` 执行以下完整性检查：

1. 重新计算并验证 Commit 8.2 `calibrationResultHash`；
2. 绑定 Commit 7 Frozen PoseClip、Production Result、四个 Frame Execution Key 与 Raw Hash；
3. 重新计算 Raw、Candidate Matted 和 Candidate Normalized CAS bytes 的 SHA-256；
4. 对同一份 Normalized RGBA 并排运行 Anchor 1.0.1 与 1.1.0；
5. 将 Candidate Anchored bytes 发布到独立 Calibration CAS，并证明其 Content Hash 与 Normalized 相同；
6. 使用实际 Candidate RGBA CAS、正式 `RgbaPoseClipContinuityFeatureExtractor` 和 `DeterministicPoseClipContinuityEvaluator` 重新收集 Continuity；
7. 输出独立 `calibrationResultHash`。

默认报告为：

```text
experiments/comfyui-feasibility/reports/anchor-calibration.json
```

Continuity 输入是为离线校准建立的 hash-valid Frame Result evidence，最终 Anchored Asset 由 Resolver 从真实 Candidate CAS 读取并重新校验 Content Hash。它不是一次新的 GPU Production E2E，也不会生成新的 Production Result 或替换 Frozen Manifest。

## 四帧结果

| Frame | 1.0.1 bilateral | 1.1.0 bilateral | Global foot changed | Anchored pixels changed |
| ---: | --- | --- | --- | --- |
| 0 | both present | both present | no | no |
| 1 | left missing | left `(0.322266, 0.928385)`; right present | no | no |
| 2 | both present | both present | no | no |
| 3 | both present | both present | no | no |

自动 Gate 全部通过：

- 四帧 Normalized CAS bytes 均重新验 Hash；
- 四帧 Candidate Anchored Content Hash 均等于输入 Normalized Content Hash；
- 四帧全局 `foot` 与 1.0.1 完全相同；
- 四帧 `leftFoot/rightFoot` 均存在；
- 全部 Anchor 坐标处于归一化画布内；
- 四个离线 Continuity Frame QA 均具备必需 Anchor。

## Real Continuity 诊断

真实像素特征与正式 Evaluator 已重新运行：

```text
status                 passed
automatedReady         true
evaluationHash         4982f33efa722d82114a644eda58dd422abb171e9567747a024a4d69c971f72e
identity maxDelta      0.0456353771
scale maxDelta         0.1323615594
body maxDelta          0.1292922326
foot maxDelta          0.1660360486
anchor maxDelta        0.0419921875
silhouette maxDelta    0.1929799333
loop maxDelta          0.1331386828
```

这些值只使用原 Commit 7 的 `warning=1 / failure=2` collection thresholds，因此报告明确标记 `collection-only-not-calibrated`。`passed` 证明真实 RGBA Continuity 路径已成功重放，不代表阈值已具备生产意义。

## Result Identity

```text
calibrationResultHash
= 6e0c66465a3c2517ecb8fe9404b3179af9965f828f729b23b2101213debfdbc3
```

该 Hash 绑定 Frozen Source、Commit 8.2 Result、Baseline/Candidate Anchor Spec、Continuity Specs、逐帧 CAS Hash、Baseline/Candidate Anchors、全部 Gate 结果与 Continuity Evaluation。

## 结论

M4 Commit 8.3 的 Bilateral Foot Anchor Automated Candidate Gate 可以判定 **PASS**。Frame 1 的真实双足缺口已关闭，1.0.1 全局支撑语义与 Anchored pixels 均未漂移。

Production Profile 仍保持旧 Matting/Anchor，Visual Approval 仍为 `pending`，Continuity 阈值也没有冻结。下一步应对 Matting 1.1.0 + Anchor 1.1.0 的四帧候选做人工透明背景视觉审批，再决定是否进入 Production Profile 与多批次 Continuity 阈值校准。
