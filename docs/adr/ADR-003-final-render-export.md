# ADR-003：Final Render 采用 PixiJS Frame Export + FFmpeg

| 项目 | 内容 |
|---|---|
| 状态 | Accepted / Frozen |
| 日期 | 2026-08-12 |
| 决策范围 | MVP、M0、M1 的 Preview、Final Frame Export 与视频编码 |
| 替代方案 | Remotion Final Render Pipeline |

## 背景

架构基线曾将 Pixi Frame Export 与 Remotion 同时保留为 M0 开放决策。Renderer Gate 已经实际跑通 300 帧、1280×720、30 FPS 的完整链路，并验证同一 Frame 的 Preview 与 Final PNG 可保持精确 RGBA 一致。继续维护第二套视频运行时会扩大状态面，并使 Camera、Crossfade、Attachment、排序和 Alpha 行为产生分叉风险。

## 决策

MVP、M0 与 M1 的 Final Render Path 冻结为：

```text
RenderPlan
→ PreparedRenderPlan
→ FrameEvaluator
→ RenderState
→ PixiJS
→ Canonical 1280×720 WebGL Framebuffer
→ PNG Frame Sequence
→ FFmpeg
→ MP4
```

Preview 与 Final 必须使用同一个 `paper-pixi` Renderer Adapter。Preview 只在 canonical framebuffer 输出后进行 CSS/Canvas 显示缩放；Final Export 读取相同 framebuffer，不建立第二套 Camera、Timeline 或 Scene Runtime。

FFmpeg 负责帧序列编码、像素格式转换与 MP4 封装。Renderer 不承担视频编码职责。

## 原因

- Preview 与 Final 共享 Renderer，减少视觉不一致；
- 只维护一套运行时状态与 Camera/Parallax 数学；
- 任意 Frame 可直接 Seek、重渲染和恢复；
- 便于 RenderState Golden、PNG Golden 和逐像素 QA；
- 可以分别验证 Evaluator Determinism 与 Renderer Pixel Determinism；
- FFmpeg 已稳定承担最终编码，无需在渲染层重复视频能力；
- Renderer Gate 已证明该链路可生成 10 秒 H.264 MP4。

## 确定性约束

对于同一个 PreparedRenderPlan、Frame、资产集合和 Renderer 环境：

```text
new Renderer → render(frame N)
```

与：

```text
new Renderer
→ render(arbitrary prior frames)
→ render(frame N)
```

解码后的最终 RGBA 必须完全相等。PNG 文件字节是否相等不是合同；合同是宽高一致、`differingPixels = 0` 且 `maxChannelDelta = 0`。

## 不采用 Remotion

MVP、M0 与 M1 不采用 Remotion 作为 Final Renderer，也不实现 Pixi 与 Remotion 双输出。

只有当后续出现经过实验确认、且 Pixi + FFmpeg 难以合理满足的明确需求，例如复杂字幕排版、视频片段编排或外部视频生态集成，才允许通过新的 ADR 重新评估。重新评估不得默认授权两套 Renderer 长期并存。

## 后果

- Frame Export 与 PNG 写盘是当前主要性能成本，应单独 Benchmark；
- FFmpeg 路径、版本和参数必须进入生产任务的 Producer/Tool Version 与 Cache Material；
- Renderer 环境（GPU/SwiftShader、浏览器、WebGL 实现）需要记录在 QA 报告中；
- 跨不同 GPU 或驱动的像素一致性不由本 ADR 自动保证，需要独立兼容性基线。

## 验证证据

`experiments/renderer-feasibility` 已在 SwiftShader 与 Intel Arc 两种环境完成 Renderer Pixel Determinism 与 300 帧性能基线；结果记录在各自生成的 `renderer-gate-report.json`。
