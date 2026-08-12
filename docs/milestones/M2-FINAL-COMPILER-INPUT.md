# M2 Final Compiler Input / Asset Binding

状态：Commit 6A implemented

Final Compiler 开工前冻结四项输入语义：

- `ExpandedAction.requiredPoseClipIds` 必须按精确 ID 存在，PoseClip entityType 必须与 Actor 一致，绑定的 EntityDefinition 必须声明对应 Clip。
- `ResolvedAssetCatalog.characterBindings` 显式建立 `characterId -> entityDefinitionId`，禁止按 entityType 数组顺序猜测。
- `FinalCompileContext` 显式提供稳定 seed、compilerVersion 与 compiledAt；Compiler 不从随机数、墙钟或环境中推断这些值。
- M2 不编译 Optional Action，并为每个被省略动作产生 `OPTIONAL_ACTION_DROPPED` Info Diagnostic。

Capability Catalog 同时提前验证每个 Action requiredPoseClips 都被所属 EntityCapability.poseClips 声明。

下一步 Commit 6B 才开始 Timeline/RenderPlan Builder，并且只产生一个 Canonical Timeline。
