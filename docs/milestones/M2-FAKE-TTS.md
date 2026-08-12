# M2 Deterministic Fake TTS

状态：Commit 4 implemented

## 数据链

```text
NarrationIntent
  -> NarrationSegment
  -> TtsRequest + inputHash
  -> Deterministic Fake TTS
  -> PCM16 WAV bytes
     -> SHA-256 -> Audio AssetRecord
     -> independent RIFF measurement -> MeasuredAudio
```

## 固定格式

- 48,000 Hz
- Mono
- 16-bit signed PCM
- RIFF/WAVE
- `sampleFrameCount` 是时长权威值
- `durationSeconds = sampleFrameCount / sampleRate` 只在需要展示或计算时派生

Fake TTS 根据语言、文本单位数和 `speed` 计算确定性帧数，并使用 TTS Request Hash 派生固定音调；实现不使用随机数。同一个 TTS Request 必须产生完全一致的 WAV bytes、WAV SHA-256、AssetRecord 与 MeasuredAudio。

WAV Measurer 不信任生成器的帧数，而是独立解析 RIFF `fmt ` 与 `data` chunk，通过 `dataByteLength / blockAlign` 得出 `sampleFrameCount`。

## 完整性约束

- Preflight 所有持久化集合 ID 唯一。
- 每个 NarrationSegment 必须恰好对应一个 TtsRequest。
- `MeasuredAudio.sourceTtsRequestHash == TtsRequest.inputHash`。
- `MeasuredAudio.assetId` 必须存在于 ResolvedAssetCatalog。
- 对应 AssetRecord 必须为 `kind=audio`。
- AssetRecord 与 MeasuredAudio 的 `contentHash` 必须一致。

下一步是 Commit 5 Duration Solver。SolvedTimingPlan 只能作为 Final Compiler 内部结果，不新增持久化 Timeline。

Final Compiler 开工前还需收紧 Final Asset Binding：逐一验证 `ExpandedAction.requiredPoseClipIds` 的精确 PoseClip ID，并确认相应 EntityDefinition 声明这些 PoseClip。该项不属于 Fake TTS Commit。
