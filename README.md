# AI 2.5D Pose-Clip Animation Compiler

基于 Whole-body PoseClip、受限动作语法、确定性 Timeline Compiler 和 AI 资产生产线的 2.5D 漫剧生成系统。

当前里程碑：**M3 Commit 3.1.2 — Result Evidence & Generation Resume Closure / PASS / Frozen**。M3 Commit 3.0.1 保持 PASS / Frozen；FrameJob 已可经 ComfyUI 单图 Provider、CAS、Matting、Normalize、Anchor、Frame QA 形成完整 Frame Result。最终 Result Hash 绑定完整 `frameExecutionKey`；ComfyUI 已按 Submit 与 Collect 分阶段重试并缓存 promptId，已知任务不会因 Poll/Download 瞬时错误重复提交。当前 Processor 为确定性 Reference 实现，尚未替换为生产级 Matting/Normalize/Anchor 算法或持久化 Task Graph Executor。

## 已冻结的实现边界

- `packages/schemas`：唯一的跨模块数据契约，包含严格 SHA-256 Hash、PoseClip/Composite Slot、Ownership、Timeline、RenderPlan/RenderState 和 Task Graph。
- `packages/paper-engine`：纯 TypeScript、无副作用、无逐帧历史依赖的确定性求值器。
- `packages/paper-pixi`：只消费 `RenderState` 的 PixiJS v8 Adapter；Texture Cache 仅接收经 `VerifiedAssetResolver` 按真实 bytes 校验过的资产，并负责 Sprite Registry、Canonical Camera Transform 与 PNG Frame Export。
- `packages/compiler` v0.3.3：在唯一 Final Compile 中生成 Landmark、Interaction Contact、Effect Cue、Baked Ownership、Composition Camera 和 Canonical Timeline。
- `packages/audio` v0.2：正式 `ITtsProvider` 与 Qwen3 provider，声音绑定 `TtsRequest.voiceId`，raw cache 绑定模型、Speaker、Instruct、Seed、Text 和 Language。
- `packages/visual-qa`：已产品化的 Final-frame Meaningful Motion 与 Visual Event Cadence 判定。
- `experiments/renderer-feasibility`：真实 Chrome/WebGL → 300 PNG → FFmpeg → 10 秒 MP4 的 M0 Renderer Gate，并对关键帧执行 Preview/Final 精确 RGBA 比较。
- `prepareRenderPlan(input)`：一次性执行 Schema、跨引用与 Ownership Timeline 校验，冻结计划并建立运行时不可写索引。
- `evaluate(prepared, frame)`：任意顺序直接求值，输出已稳定排序且可交给 Renderer 的 `RenderState`。

Paper Engine v0.1 已实现：

- 严格递增 Keyframe、四边形 Ground Projection 和确定性插值；
- Timeline 的 Pose/Ownership/Visibility/Effect/Audio/Subtitle/Transition/Marker 事件共享唯一 ID namespace；Environment Layer ID 在所属 Environment 内唯一；
- Whole-body PoseClip 与 2～4 帧 Crossfade，`transitionWeight` 独立于最终透明度；
- Contact Segment GroundLock：接触段起点锁定、随机帧直接求值，并以包含 Foot Anchor、Asset Size、Scale 和 Rotation 的完整 `visualCorrectionPx` 执行修正上限；
- Ownership 状态机：同帧冲突、`from` 链、自挂载、环、深度、Socket/Baked Binding 均在 Prepare 阶段验证；MVP 禁止 `preserveWorldTransform=true`，Detach 连续性必须由 Compiler 写入 World Track；
- Socket Attachment 与显式 Composite Slot Baked Attachment；
- Socket Attachment 在 Owner Pose Crossfade 中按 `transitionWeight` 混合 Anchor Position、Rotation 和 Scale；Baked Ownership Event 禁止发生在 Crossfade 区间内；
- Socket Child 继承 Owner 的可渲染性；Owner 因 Visibility、Scene 或 activeRange 不渲染时，Child 同样不输出；
- PoseTransition 在 Prepare 阶段验证实际 `fromPoseClipId`，同一 Entity 的 Transition 区间不得重叠；
- PoseTransition 的 `anchorPolicy=foot|center` 均已落实，from/to 对齐到同一个加权 World Point；
- 每个 Shot 必须显式提供从 Shot 起始帧开始的唯一 CameraTrack，不存在 `{0,0}` 隐式默认镜头；
- Paper Engine 与 Pixi 内部只使用 Canonical 1280×720；Preview 通过 Canvas/CSS 等比例显示缩放，不得以 640×360 viewport 重新求值；
- `CameraSpace`/parallax 完整合同：环境层带 influence，实体固定为 world influence 1，world position/scale/rotation 统一经过 Camera，screen 元素保持不变；
- 事件型 Golden Fixture V2：18 份完整 RenderState JSON 覆盖 GroundLock、Socket/Baked Attach、Crossfade 和两类 Detach 的前/中/后边界；
- 固定种子的随机属性测试，覆盖确定性、排序键、可见主体数量和合法 Crossfade。

## 开发命令

```powershell
pnpm install
pnpm check
pnpm test
pnpm build
```

本地依赖镜像异常时，可直接运行仓库内工具链：

```powershell
node node_modules/typescript/bin/tsc -p packages/schemas/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p packages/paper-engine/tsconfig.json --noEmit
node node_modules/vitest/vitest.mjs run packages/schemas packages/paper-engine packages/paper-pixi experiments/renderer-feasibility
```

有意修改 Renderer Contract 后，先构建 Paper Engine，再显式更新 Golden：

```powershell
pnpm --filter @pose-clip/paper-engine build
pnpm --filter @pose-clip/paper-engine golden:update
```

## 依赖方向

```text
schemas → paper-engine → paper-pixi → PNG → FFmpeg
                    ↘ compiler / QA adapters
```

React、PixiJS、Gemini、ComfyUI 和 FFmpeg 不得成为 `paper-engine` 的依赖。Renderer 只消费 `RenderState`；不得反向定义 Timeline、PoseClip、Ownership、GroundLock 或 CameraSpace 语义。

详细状态见 [M0 Paper Engine v0.1 里程碑](docs/milestones/M0-paper-engine-v0.1.md)、[M0 Renderer Gate](docs/milestones/M0-renderer-gate.md)与 [ADR-003 Final Export](docs/adr/ADR-003-final-render-export.md)。
