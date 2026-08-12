# M2 Final Compiler Input / Asset Binding

状态：Commit 6A.1 PASS / Frozen

Final Compiler 输入绑定已冻结：

- `Capability.Action.poseBindings` 为每个支持方向声明唯一 `poseClipId`。
- `Capability.Action.defaultDirection` 显式声明省略 Action direction 时的语义，禁止使用数组首项作为默认值。
- Preflight 负责将导演的动作与方向解析为 `ExpandedAction.poseClipId`；Final Compiler 不再选择或猜测 PoseClip。
- Required Action 的执行 `poseClipId` 必须按精确 ID 存在、entityType 必须与 Actor 一致，且绑定的 EntityDefinition 必须声明该 Clip。
- Optional Action 不参与精确 PoseClip Asset Gate；M2 直接省略并产生 `OPTIONAL_ACTION_DROPPED` Info Diagnostic。
- `ResolvedAssetCatalog.characterBindings` 显式建立 `characterId -> entityDefinitionId`，禁止按 entityType 或数组顺序猜资产。
- `FinalCompileContext` 显式提供 seed、compilerVersion 与 compiledAt；Compiler 不读取随机数、墙钟或环境变量生成这些值。

复杂动作以后必须在 Preflight 展开为多个 ExpandedAction，每个 ExpandedAction 仍只执行一个确定 PoseClip。
