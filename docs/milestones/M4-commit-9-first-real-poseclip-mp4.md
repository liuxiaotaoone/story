# M4 Commit 9 — First Real PoseClip MP4

状态：**Candidate Integration Gate PASS；Candidate Animation Profile FROZEN；Production Approval PENDING**

本提交停止继续调整 Matting/Normalize/Anchor，把经过人工审批的四张真实 Candidate PNG 首次接入：

```text
Frozen admitted Raw
→ Matting 1.1.0
→ Normalize 1.0.1
→ Anchor 1.1.0
→ Candidate PoseClip
→ Paper Engine / GroundLock
→ Paper Pixi
→ 120 × canonical PNG
→ FFmpeg / H.264 MP4
```

没有重新运行 ComfyUI/GPU，也没有修改四张 Candidate PNG、PoseClip Frame、Anchor 或 Continuity 数值。

## Human Visual Approval

人工审核已经批准：

- `chroma-key-matting@1.1.0`：Visual Candidate PASS；
- `alpha-geometry-anchor@1.1.0`：Visual Candidate PASS；
- Frame 1 双侧脚点缺口已关闭；
- `leftFoot/rightFoot` 明确定义为 screen-left/screen-right support，不是解剖学左右脚；
- `Production Approval` 继续保持 false；
- Continuity 阈值继续保持 collection-only。

审批证据：

```text
review/candidate-visual-approval.json
approvalHash
= 6dca397a916a21e2f64a93e4791a3a1b0b2a3e3c64eae1ff79fcd9fd34c81087
```

## Candidate Production Identity

基于 Frozen admitted Raw 离线重放完整后处理链，形成新的候选身份：

```text
Candidate Profile Hash
= 5719c0677b1ae7baad7562164fac5929986c1215c5c8a157661721ce7de2c694

FrameExecutionKey[0]
= 5679370c0b4d4fd9294bf079850f25177f5a136f2a5f362c9836dd7962dc3a00
FrameExecutionKey[1]
= ecddbab1f8e7f7a762bb9af0e65d6e32e15fa6322b394f4f17fbb44716566caa
FrameExecutionKey[2]
= 16e712f45a44e4cf565629652d887a7a1d10090e9e5219a8cb40dc45cd9e48ed
FrameExecutionKey[3]
= ed33ef0ec051f51a1e0295ad7697027afd0bdec8d549b7f91f0ff138e527785d

PoseClip Hash
= 7c760d4d28b6019ae97ea783841c96bd1ee60b61b8bd81340b399b9efe894b55

Production Result Hash
= ce543eb3a97cafc802d306640854ff4cf0b1200bfeb850cb93dcf4a3160ec5a6
```

重放命令：

```powershell
pnpm --filter @pose-clip/comfyui-feasibility production:replay
```

`productionReady=false` 是预期结果，因为 Profile Approval 和正式 Continuity 阈值仍未批准；它不否定 Candidate Replay Gate。

## Paper Engine Admission

四份 Anchored bytes 在写入 Renderer Candidate Package 前重新计算 SHA-256，并通过 `VerifiedAssetResolver` 再次验证。RenderPlan 使用原 Candidate PoseClip：每张图持续 3 帧、`contact=both`、`referenceFoot=midpoint`。

```text
RenderPlan Hash
= 823d954e99c1349c337764fa0581543ad7109fa688cf69dd4d239a65e48f5ba7
```

集成时暴露了一个真实限制：Candidate PoseClip 的全局 `foot` 与双侧支撑中点距离较大。角色按 0.75/0.32 Ground Scale 显示时，GroundLock Visual Correction 超过 Frozen `maxCorrectionPx=24`，引擎正确 fail-closed。最终评审舞台使用 Ground Scale `0.275`，再以 Camera Zoom `2.2` 构图；这不修改 PoseClip、Anchor 或 Candidate Asset Identity。

## First Real MP4

```text
Resolution       1280 × 720
Frame rate       30 fps
Frame count      120
Duration         4 s
Codec            H.264 / libx264
Pixel format     yuv420p
Video SHA-256    8589382e51cd836d68df599e632ac0eb1635a850e50d827bada3554ded81aeb6
```

文件：

```text
experiments/comfyui-feasibility/review/first-real-mp4/rabbit-real-candidate-4s.mp4
```

这条 MP4 是 Paper Engine Integration Test Asset，不是最终视觉质量批准。它应重点用于人工观察：

- GroundLock 是否稳定；
- 四帧切换时角色身份、身体比例和轮廓跳变；
- Frame 3 → Frame 0 的 Loop Closure。

## 结论

真实 Asset Processing 已具备进入视频引擎测试的条件，首条真实 MP4 链路已经闭环。下一阶段的主要矛盾正式转为 Generation / Continuity Quality；不要继续围绕 Anchor 参数开提交。

## Playback Tempo Isolation Experiment

首条 0.4 秒循环经人工观看确认过快。为把“播放节奏”和“生成内容一致性”分开，复用完全相同的四张 PNG、Anchor、GroundLock、Camera 和 Renderer，关闭 Crossfade/Transition，只改 Pose 持续帧数：

| Variant | Pose durations | Cycle | Comparison length |
| --- | --- | ---: | ---: |
| 0.8s | 6 / 6 / 6 / 6 | 24 frames | 72 frames / 3 cycles |
| 1.0s | 7 / 8 / 7 / 8 | 30 frames | 90 frames / 3 cycles |
| 1.2s | 9 / 9 / 9 / 9 | 36 frames | 108 frames / 3 cycles |

三版都是 review-only Playback Override，不回写 Candidate Production PoseClip，也不改变 Candidate Profile、FrameExecutionKey 或四张 Asset Content Hash。报告位于：

```text
experiments/comfyui-feasibility/reports/pose-tempo-comparison.json
```

视频位于：

```text
experiments/comfyui-feasibility/review/tempo-comparison/
```

人工节奏偏好继续保持 `pending`；选择结果应在观看三版后记录，不能由自动化脚本代填。

### Human Tempo Selection

三版经逐帧人工审核后，`1.0s` 被选为当前 Rabbit Candidate 默认节奏：

```text
1.0s      candidate-default
0.8s      fast-motion-reference
1.2s      slow-idle-reference
```

审批证据：

```text
review/tempo-human-preference.json
approvalHash
= b0675e04065bef4e1f8a1d7f5d9f09dcc5038a4f83201e0c3c225c886347144e
```

该选择只授权 review playback default 和下一步 Transition baseline，不回写 Production Candidate PoseClip，也不批准 Production Profile。

## 1.0s + 100ms Pose Transition

基于 Human-selected 1.0s 节奏，把四张 Frame 分别封装为单帧 PoseClip，并在每次 Pose 切换使用 Paper Engine 已冻结的 Crossfade：

```text
Cycle                    30 frames / 1.0s
Transition               3 frames / 100ms
Anchor policy            foot
Transitions per cycle    4
Comparison               3 cycles / 90 frames
```

周期布局：

```text
Pose 0 hold 4f → transition 3f
Pose 1 hold 5f → transition 3f
Pose 2 hold 4f → transition 3f
Pose 3 hold 5f → transition 3f
```

Transition RenderPlan Hash：

```text
bd9a4e2a8a59568eecce14ec2a290809b94ea92602d78c6d51d571bb1fa0cb59
```

MP4：

```text
review/pose-transition/rabbit-real-tempo-1.0s-transition-100ms.mp4
SHA-256
= 7782e2cd5aac48da7c3cce9d0aa761f444eac148d2854bc77ee5bee9a3fe8db3
```

关键帧技术检查确认权重和 Foot Anchor 对齐正确，但 1/3 与 2/3 混合帧能看到双兔轮廓。该现象来自源 Pose 的身体结构差异，不是 Renderer 或 GroundLock 错误。因此此视频保持 `Human Review PENDING`，用于判断 100ms Crossfade 是否总体优于 1.0s Hard Cut，不能自动升级为视觉 PASS。

### 100ms Human Review

逐帧人工对比确认：100ms Crossfade 将兔子区域最大相邻帧变化从约 `13.05` 降至 `8.52`，峰值下降约 35%；但两个混合中间帧出现不可接受的双耳、双眼、双腿和身体轮廓。因此：

```text
100ms temporal smoothing       effective
100ms default promotion       rejected
GroundLock / Anchor           unchanged and stable
2-frame experiment            authorized
complex Crossfade tuning      rejected
```

审核证据：

```text
review/transition-100ms-human-review.json
approvalHash
= 58b303988c968ebafbe935ba44c035d60c67a8c38dca06cfae2753582ed8907f
```

### 1.0s + 2-frame / 66.7ms Transition

最后一版 Transition 参数实验将每次 Crossfade 缩至 2 帧：首帧保持旧 Pose，第二帧为唯一主要 50/50 Blend，随后进入新 Pose。周期仍为 30 帧：

```text
Pose 0 hold 5f → transition 2f
Pose 1 hold 6f → transition 2f
Pose 2 hold 5f → transition 2f
Pose 3 hold 6f → transition 2f
```

```text
RenderPlan Hash
= 74fae4cfb4986a0f10bf76529f8ca12e6f231e977acb8a3961e32b0336778082

MP4 SHA-256
= ece7f97074345338a672ac3f329d7788a65257743a2f1aad0260ec3166144f4e
```

文件：

```text
review/pose-transition/rabbit-real-tempo-1.0s-transition-67ms.mp4
```

关键帧检查确认持续双影已从两个混合帧缩短为一个 50/50 混合帧，Foot Anchor 与 GroundLock 继续稳定。该视频保持 Human Review pending，但 Transition Duration 参数探索到此收口；后续主线切换为 `comfyui-generation-consistency`。

### Candidate Animation Profile Frozen

67ms 视频经人工审核后获批为当前 Rabbit Candidate 默认 Transition。内部冻结整数帧语义，不冻结任意毫秒小数：

```text
fps                  30
cycleFrames          30
cycleDuration        1.0s
transitionMode       crossfade
transitionFrames     2
transitionDuration   transitionFrames / fps
anchorPolicy         foot
```

Human Approval：

```text
review/transition-67ms-human-approval.json
approvalHash
= 020220fb0ec6b6c9c689d9864a793cba372c972c9a678742e7e887292de238c5
```

Frozen Candidate Animation Profile：

```text
frozen/rabbit-candidate-animation-profile.json
profileHash
= 27827562aa8232234e2b2e8ff48827c08bd2dee0ae6d3c0603eb63d78d5ec543
```

该 Frozen Scope 只覆盖 Candidate Cycle/Transition 参数。Production Approval、Continuity Threshold、Generation Identity、Pose Geometry 和动作类型专属节奏均未冻结。Tempo/Transition 参数探索正式关闭，下一主线唯一指向 ComfyUI Generation Consistency。
