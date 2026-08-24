# M4 Commit 8.1 — Quality Evidence Closure

状态：**Contract / Integrity Gate PASS**

本提交只关闭 M4 Commit 8 Quality Analyzer 的 Evidence 缺口，不修改 Generation、Matting Processor、Normalize、Anchor、Bridge、Continuity、Production Orchestrator 或 Frozen M4 Commit 7 Identity。

## 可信输入链

`production:analyze` 不再接受任意四帧 PASS Report。分析开始前强制建立：

```text
Frozen Commit 7 PASS Manifest
              │
              ▼
production-e2e.json
  PoseClip Hash
  Production Result Hash
  Admission Identity
  Frame Execution Keys × 4
  Stage Content Hashes × 16
              │
              ▼
CAS PNG bytes × 16
  SHA-256(bytes) == artifact.contentHash
              │
              ▼
Quality Measurement
```

任何身份或 Artifact Hash 不一致都会在读取像素前返回：

```text
QUALITY_ANALYSIS_FROZEN_RUN_MISMATCH
```

任何 CAS bytes 与声明 Content Hash 不一致都会返回：

```text
QUALITY_ANALYSIS_CAS_HASH_MISMATCH
```

错误证据按可用上下文记录 `frameIndex`、`stage`、`expected` 与 `actual`；发生错配后不会继续 Decode、Normalize Plan 或 Quality Measurement。

## 分析算法身份

质量算法集中定义在：

```text
experiments/comfyui-feasibility/frozen/rgba-quality-baseline-spec.json
```

当前身份为：

```text
rgba-quality-baseline@1.0.0
qualityAnalysisSpecHash = 4f89721292d374b07af9f900cb14a7304500b6b3fef2613b78a6534be14b1dd2
normalizationProcessorSpecHash = 596403b5aebbac19a6a1b7257e6fc2aed22ffb4fc2b9d82697efd14b64d56d3a
```

Spec 固定 Normalize Processor/Config 以及以下像素语义：

```text
foreground       alpha >= 8
soft edge        8 <= alpha < 247
green minimum    green >= 64
green dominance  green - max(red, blue) >= 24
```

Spec 使用 Canonical JSON domain hash。未来任何阈值、Green 定义或 Normalize 参数改变，都会产生新的 `qualityAnalysisSpecHash`，不能冒充相同基线。

## 确定性质量报告

执行：

```powershell
pnpm --filter @pose-clip/comfyui-feasibility production:analyze
```

默认输出：

```text
experiments/comfyui-feasibility/reports/production-quality-analysis.json
```

报告包含：

- Frozen PASS Manifest Canonical Hash；
- Source PASS Report 中被验证身份载荷的 Canonical Binding Hash；
- PoseClip Hash 与 Production Result Hash；
- Quality Analysis Spec Hash 与 Normalize Processor Spec Hash；
- 四个 Frame Execution Keys；
- 16 个重新验证的 CAS Content Hash；
- 每帧 Normalize Transform；
- Matted、Normalized、Anchored 像素测量；
- 对以上语义载荷计算的 `analysisResultHash`。

当前真实基线：

```text
frozenPassManifestHash  = 28de5950bf55645d64fd83871f93298d44c48e4b64e855096dc29c59151da555
sourceReportBindingHash = a3962611c52bec323fc36b2713a66dd9f5a16f074290ffbceb808a76479d97f7
analysisResultHash      = d5176a4df656b8ac66c490f68d939169ecdf32adad1fdbbcbdb83e7fbde7efe2
```

Hash 不依赖 JSON 缩进或 CRLF/LF。报告不含分析执行时间等非语义字段，因此相同 Frozen Source、CAS bytes 和 Spec 会产生相同 Result Hash。

## Gate 结论

```text
Analysis → Frozen Run bind       PASS
CAS byte re-verification         PASS
Analysis Algorithm Identity      PASS
Deterministic Result Identity    PASS
Matting Calibration              NOT STARTED
Continuity Threshold Calibration DEFERRED
Production Approval              PENDING
```

Commit 8.1 完成后，下一步可以开始 Matting Calibration。正确顺序仍是先改善 Matting，再重新运行 Normalize、Anchor 和 Continuity；当前不批准 Continuity 生产阈值。
