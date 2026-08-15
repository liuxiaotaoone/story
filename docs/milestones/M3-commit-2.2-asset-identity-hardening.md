# M3 Commit 2.2 — Asset Identity Hardening

状态：**PASS / Frozen**

## 目标

关闭“AssetRecord 声明未变化、物理文件却被替换后仍可渲染”的完整性漏洞，并移除 RenderPlan 语义身份对本机绝对路径和资产生成时间的依赖。

## 冻结链路

```text
RenderPlan AssetRecord
→ AssetByteResolver（local / HTTP / object storage adapter）
→ physical bytes
→ VerifiedAssetResolver
→ SHA-256(bytes) == AssetRecord.contentHash
→ VerifiedAsset
→ TextureCache
→ Pixi Texture
```

任何 Hash 不一致都会在 Texture 创建前抛出 `AssetIntegrityError`。`TextureCache` 不再把 `asset.uri` 直接交给 Pixi，也拒绝在同一 Cache 中用相同 Asset ID 加载不同 `contentHash`。

## 逻辑地址与物理地址

ComfyUI Provider 仍在 `GeneratedImageArtifact.filePath` 返回实际落盘路径，文件名使用完整 PNG SHA-256；写入 `VisualAssetRecord.uri` 的地址固定为：

```text
asset://sha256/<64-character-lowercase-sha256>
```

`AssetRecord` 会校验逻辑 URI 中的 Hash 必须与 `contentHash` 一致。Local Cache、HTTP、MinIO 或 S3 的位置映射属于注入给 `VerifiedAssetResolver` 的 `AssetByteResolver`，不进入 RenderPlan 动画语义。

## Semantic RenderPlan Hash

默认 `semanticRenderPlanHash()` 已升级到 `render-plan-semantic-v2`：

- 包含 Asset ID、Kind、Content Hash、尺寸、Alpha、Anchor 与除时间外的 Provenance；
- 排除 `asset.uri`；
- 排除 `asset.provenance.createdAt`；
- Timeline、PoseClip 或真实 Asset Content Hash 改变时仍会改变。

已冻结的 M2/M2.1 证据继续通过显式 `semanticRenderPlanHashV1()` 验证，旧 Manifest 不重写，新旧算法不混用。

## Provider 边界

ComfyUI Provider 仍只负责 `GenerationRequest → Raw PNG Artifact`。Matting、Normalize、Anchor、Continuity QA、PoseClip Assembly 与 Retry/Task Graph 不进入 Provider。

## 验收

- 相同 bytes 与声明 Hash：允许进入 Texture Loader；
- bytes 被替换：Texture Loader 未调用，立即失败；
- 相同 Asset ID 在同一 Cache 中发生 Content Hash 漂移：失败；
- 只改变 URI 或 `provenance.createdAt`：Semantic RenderPlan Hash v2 不变；
- 旧 M2/M2.1 Frozen Evidence：仍使用 v1 Hash 完整验证；
- Renderer feasibility 的内置 SVG Fixture 使用真实内容 Hash，不依赖测试假 Hash。

下一步：**M3 Commit 3 — Multi-frame PoseClip Production Contract**。
