# M0 Renderer Gate — PixiJS v0.1

状态：技术验证通过。Paper Engine 未增加 Renderer 语义；AI Asset Gate 仍是独立的 M0 投资门槛。

## 已验证链路

```text
RenderPlan
→ PreparedRenderPlan
→ FrameEvaluator
→ RenderState
→ paper-pixi
→ Canonical WebGL Framebuffer
→ PNG sequence
→ FFmpeg
→ H.264 MP4
```

## 冻结约束

- Pixi 内部固定 1280×720、30 FPS；Preview 只允许渲染完成后的 CSS/Canvas 等比缩放。
- Renderer 按 `RenderState.sprites` 的既有顺序提交，不重新推理 RenderLayer、zIndex、depth 或 stableSortKey。
- Camera/Parallax 只调用 Paper Engine 的 `resolveCameraSpaceTransform()`，Renderer 不维护第二套数学。
- `renderId → Sprite` 注册表跨帧复用；Crossfade 的 from/to Sprite 可同时存在。
- Texture Cache 只执行 `assetId → Texture` 预加载与查找，不解释 Asset 的故事语义。
- Final PNG 读取与 Preview 相同的已完成 canonical framebuffer，避免为导出再次渲染 RenderTexture。

## 验收结果

- 300 帧，1280×720，30 FPS，输出 10.000 秒 H.264 MP4。
- 关键帧 3、20、31、50、60、79 覆盖 GroundLock、Crossfade、Socket/Baked Attachment、Camera 与前景排序。
- 所有关键帧 Preview/Final 对照均为 `differingPixels=0`、`maxChannelDelta=0`。
- 仓库测试共 73 项通过；schemas、paper-engine、paper-pixi 与 renderer-feasibility strict TypeScript 检查通过。

运行入口与生成物说明见 `experiments/renderer-feasibility/README.md`。生成物位于被 Git 忽略的 `output/` 目录。
