# AI 2.5D Pose-Clip Animation Compiler

基于 Whole-body PoseClip、受限动作语法、确定性 Timeline Compiler 和 AI 资产生产线的 2.5D 漫剧生成系统。

项目当前处于 M0：Architecture + Renderer/Asset Feasibility。

## 架构基线

- `AI 2.5D Pose-Clip Animation Compiler 技术设计文档 V1.md`
- `docs/adr/ADR-001-whole-body-pose-clip.md`

## 当前实现

`packages/schemas` 是项目的第一项正式代码，包含：

- Asset、PoseClip、Attachment、Entity、Environment；
- DirectorPlan、DirectorOverride、CapabilityCatalog；
- Preflight/Final Compile 输入；
- Timeline、PoseTransition、OwnershipEvent；
- RenderPlan、RenderState、稳定排序与 Crossfade 约束；
- TaskNode、ProducerRef 与 Cache Key 输入。

所有外部 JSON 和持久化数据必须使用这里的 Zod Schema 做运行时验证。其他包不得重新定义同名领域模型。

## 开发命令

```powershell
pnpm install
pnpm check
pnpm test
pnpm build
```

## 依赖边界

```text
schemas
  ↑
paper-engine ← timeline-compiler ← director-contracts
  ↑                 ↑
paper-pixi      spatial-engine / duration-solver
```

不得从 Renderer 或 React UI 反向定义 Timeline、PoseClip、Ownership 或 RenderState 语义。
