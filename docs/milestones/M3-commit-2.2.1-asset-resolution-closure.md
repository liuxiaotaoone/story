# M3 Commit 2.2.1 — Asset Resolution Closure

状态：**PASS / Frozen**

本提交完成 Asset Identity 的最后一段集成闭环，不修改 Compiler、Timeline、Paper Engine、Renderer 动画语义或 ComfyUI Provider 职责。

## Local CAS Adapter

`LocalCasAssetByteResolver` 位于 Node 侧 `packages/asset-generation`，只负责：

```text
asset://sha256/<hash>
→ <casRoot>/<hash>.png
→ raw Uint8Array
```

它不验证文件可信性。真实 bytes 的 SHA-256 仍由 `VerifiedAssetResolver` 重新计算并与 `AssetRecord.contentHash` 比较；`paper-pixi` 不引入 `node:fs`。

## 历史 Hash 兼容

已冻结的 M2 与 M2.1 中，生成脚本和验证脚本现在都显式使用 `semanticRenderPlanHashV1()`。新项目继续使用默认 v2，历史产物不会因重新运行生成脚本而写入错误版本的 Hash。

## 集成契约

自动测试覆盖：

```text
ComfyUiProvider mock transport
→ real PNG bytes
→ <sha256>.png
→ asset://sha256/<sha256>
→ LocalCasAssetByteResolver
→ VerifiedAssetResolver
→ TextureCache
→ TextureLoader
```

该链路使用真实临时目录和真实文件读取；Texture Loader 只能收到已验证 bytes。任何 Provider 文件命名、逻辑 URI、CAS 映射或 Renderer 校验契约漂移都会使测试失败。

Asset Identity 至此永久冻结。下一步：**M3 Commit 3 — Multi-frame PoseClip Production Contract**。
