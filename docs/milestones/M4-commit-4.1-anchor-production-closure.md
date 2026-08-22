# M4 Commit 4.1 — Anchor Production Closure

状态：**Contract / Evidence / Geometry / Identity / Cache / Publication Gate PASS；Overall Candidate**

本次只关闭 Real Anchor 的两个 Production 阻塞，不修改 Raw、Matting、Normalize、M3 Frozen Contract 或 Continuity Evaluator。

## Final Asset Identity

M4 中间阶段继续使用显式后缀：

```text
Raw         frame-id
Matted      frame-id.matted
Normalized  frame-id.normalized
Anchored    frame-id
```

`anchoredAssetId()` 只接受 `.normalized` 输入并移除该后缀，不再生成 `.anchored` ID，也不为非法输入静默追加后缀。最终 Anchored Artifact 的 `asset.id` 因此重新等于 `FrameSpec.output.assetId`。

回归测试把 M4 的 Raw、Matted、Normalized、Anchored Artifact 与 Anchors 直接组装为 M3 Frozen `PoseClipFrameProductionResult`，并通过 `assertPoseClipFrameProductionResultIntegrity()`，证明 M4 结果不需要修改 Frozen Schema 即可进入后续 Bridge。

## One-side Foot Fail-closed

旧 `alpha-geometry-anchor@1.0.0` 会在一侧 foot band 没有候选时回退到全局 foot band，导致不存在的左右脚被复制出来。

`alpha-geometry-anchor@1.0.1` 改为：

```text
global foot band → independent foot
left candidates  → leftFoot | undefined
right candidates → rightFoot | undefined
```

如果 FrameSpec 要求的 Foot Anchor 未检测到，Executor 返回 `ANCHORING_REQUIRED_ANCHOR_MISSING`，并且在四帧 Gate 完成前不发布任何 Anchored CAS。

算法输出发生变化，因此 Processor version、`processorSpecHash`、Stage Cache Key 和 `anchorInputHash` 全部分叉，旧 `1.0.0` 缓存不会命中 `1.0.1`。

## 语义边界

当前左右脚仍是 screen-space 支撑候选，不是身体解剖学左右脚。Commit 4.1 只保证“不知道就不输出”，不把画面左右包装成已经验证的人体语义。正式支持 `left-foot / right-foot` 动作语义仍需真实素材 QA、关键点检测或人工 Anchor Correction。
