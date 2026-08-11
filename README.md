# AI 2.5D Pose-Clip Animation Compiler

基于 Whole-body PoseClip、受限动作语法、确定性 Timeline Compiler 和 AI 资产生产线的 2.5D 漫剧生成系统。

项目处于 M0：Architecture + Renderer/Asset Feasibility。目前已经完成 Paper Engine v0.1 的语义封口；按冻结路线，下一步才进入 Pixi Renderer 实验，不在核心求值器内引入 Renderer 状态。

## 已冻结的实现边界

- `packages/schemas`：唯一的跨模块数据契约，包含严格 SHA-256 Hash、PoseClip/Composite Slot、Ownership、Timeline、RenderPlan/RenderState 和 Task Graph。
- `packages/paper-engine`：纯 TypeScript、无副作用、无逐帧历史依赖的确定性求值器。
- `prepareRenderPlan(input)`：一次性执行 Schema、跨引用与 Ownership Timeline 校验，冻结计划并建立运行时不可写索引。
- `evaluate(prepared, frame)`：任意顺序直接求值，输出已稳定排序且可交给 Renderer 的 `RenderState`。

Paper Engine v0.1 已实现：

- 严格递增 Keyframe、四边形 Ground Projection 和确定性插值；
- Whole-body PoseClip 与 2～4 帧 Crossfade，`transitionWeight` 独立于最终透明度；
- Contact Segment GroundLock：接触段起点锁定、最大修正量约束、随机帧直接求值；
- Ownership 状态机：同帧冲突、`from` 链、自挂载、环、深度、Socket/Baked Binding 均在 Prepare 阶段验证；
- Socket Attachment 与显式 Composite Slot Baked Attachment；
- `CameraSpace`/parallax 合同：环境层带 influence，实体固定为 world influence 1，screen 元素不受 Camera 影响；
- 事件型 Golden Fixture V2：农夫、兔子、灯笼、四层环境、动作切换、GroundLock、Socket/Baked Attach、Detach、Visibility、Subtitle、SFX 和 Effect；
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
node node_modules/vitest/vitest.mjs run packages/schemas packages/paper-engine
```

## 依赖方向

```text
schemas → paper-engine → renderer adapter
                    ↘ compiler / QA adapters
```

React、PixiJS、Gemini、ComfyUI 和 FFmpeg 不得成为 `paper-engine` 的依赖。Renderer 只消费 `RenderState`；不得反向定义 Timeline、PoseClip、Ownership、GroundLock 或 CameraSpace 语义。

详细状态见 [M0 Paper Engine v0.1 里程碑](docs/milestones/M0-paper-engine-v0.1.md)。
