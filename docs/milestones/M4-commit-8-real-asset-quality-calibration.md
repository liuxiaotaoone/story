# M4 Commit 8 — Real Asset Quality Calibration

状态：**Baseline Established；Visual Production Approval PENDING**

本阶段以 M4 Commit 7 已冻结的真实 GPU 产物为唯一输入，先建立可重复的像素质量观测和人工视觉基线。当前不修改 Frozen Admission、Workflow、模型、Seed、生产合同或已通过的 E2E Gate，也不把采集阈值误写成生产阈值。

## 输入证据

- Frozen PASS Manifest：`experiments/comfyui-feasibility/frozen/production-e2e-pass-manifest.json`
- PoseClip Hash：`ffcd4ab58415adc29a7e62f6bf1562af8b567bd151216e495bc0b4463258b727`
- Production Result Hash：`720c00cac3c16f073e925562b348e60ab5cac9600666b35dba5748b2d660f7c1`
- 四帧均只有一次真实 GPU 提交；Raw、Matted、Normalized、Anchored Content Hash 已冻结在 Manifest。
- Profile Approval 与 Human Review 保持 `pending`，所以 `productionReady=false`。

## 可重复分析

不需要重新启动 ComfyUI，也不重新运行 GPU：

```powershell
pnpm --filter @pose-clip/comfyui-feasibility production:analyze
```

分析器重新读取 PASS Report 和 CAS bytes，使用生产 Normalize Processor 计算变换，并对 Matted、Normalized、Anchored RGBA 逐像素测量：

- Foreground：`alpha >= 8`；
- Soft Edge：`8 <= alpha < 247`；
- Green Dominant：`green >= 64` 且 `green - max(red, blue) >= 24`；
- Visible Green Spill：可见前景中 Green Dominant 像素占比；
- Edge Green Spill：Soft Edge 中 Green Dominant 像素占比；
- Opaque Green Residual：可见前景中同时满足 `alpha >= 247` 与 Green Dominant 的像素占比。

完全透明像素的 RGB 不进入 Green Spill 统计，避免把 PNG 隐藏色误报为可见残留。这些指标是基线观测，不是已经批准的失败阈值。

## 首批真实数据

四帧的 Normalize 变换完全相同：

```text
sourceBounds      x=0, y=0, width=512, height=768
destinationBounds x=42, y=96, width=427, height=640
scale             0.8333333333333334
canvas            512 x 768
```

Normalized 与 Anchored 的像素 Content Hash 相同，因此两者的 RGBA 指标一致；Anchor 阶段只建立 Evidence/Anchor Metadata，没有再次改写像素。

| Frame | Matted 前景覆盖 | Anchored 前景覆盖 | Anchored Soft Edge | Visible Green Spill | Edge Green Spill | Opaque Green Residual |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 39.16% | 27.35% | 24.53% | 10.50% | 35.63% | 1.76% |
| 1 | 44.46% | 31.24% | 32.73% | 17.37% | 48.58% | 1.46% |
| 2 | 42.10% | 29.61% | 28.30% | 19.15% | 59.96% | 2.18% |
| 3 | 50.87% | 35.11% | 40.80% | 15.62% | 32.10% | 2.53% |

Frame 2 的边缘 Green Spill 最严重；Frame 3 的前景覆盖、Soft Edge 和 Opaque Green Residual 最高。

## 人工视觉结论

已检查四帧的 Raw、Matted、Normalized 和 Anchored 产物：

- Raw 背景不是均匀绿幕，而是包含水彩纹理、明暗渐变和画布边缘；
- 当前 Chroma Key 去除了主要亮绿色区域，但仍留下大面积暗绿纹理、边框碎片及角色轮廓 Green Spill；
- 兔子的坐姿/站姿、眼睛样式、耳部标记、胡须、尾巴和身体色块存在帧间变化；
- Frame 2 → 3 的姿态与轮廓跳变最明显，与 `silhouette maxDelta=0.1547375` 的 Worst Pair 一致。

因此当前结论是：

```text
M4 Commit 7 Engineering E2E Gate     PASS
M4 Commit 8 Quality Baseline         ESTABLISHED
Visual Production Approval           PENDING
```

## 关键诊断

`sourceBounds` 四帧都等于完整 512×768 画布，不代表角色天然占满画布。原因是 Matting 残留在 `alpha >= 8` 下连接或散布到画布边缘，使 Normalize 把残留背景也识别为前景。

这会污染下游观测：

- 四帧相同的 Normalize Scale 不能证明角色尺度稳定；
- Anchor Movement 为零不能证明真实脚点稳定；
- Subject Bounds 一致不能证明角色轮廓一致；
- 以这些值直接收紧 Continuity Threshold，会把 Matting 误差固化成“稳定性”。

因此下一步应先校准现有 Chroma Key/Foreground 选择，再重新生成 Normalize、Anchor 和 Continuity 数据。当前不需要立即更换 AI Matting，也不应先批准视觉阈值。

## 下一 Gate

1. 用这四帧建立 Matting 参数回放集，优先处理画布边缘残留、暗绿纹理和轮廓 Green Spill。
2. 在去除背景连通区域时保护耳尖、胡须和脚部等细结构，防止以“更干净”为代价误删角色。
3. Matting 改善后重新计算真实 Subject Bounds、Normalize Transform、Anchors 和 Continuity Delta。
4. 基于修复后的多批真实数据提出 Warning/Failure Threshold，再进行人工视觉审批。
5. 只有 Profile Approval 与 Human Review 都完成后，才允许 `productionReady=true`。
