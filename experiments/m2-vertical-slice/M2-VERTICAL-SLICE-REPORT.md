# M2 Vertical Slice Report

状态：PASS / Frozen。

固定《守株待兔》Story 已通过冻结的两阶段 Compiler 自动生成唯一 Canonical Timeline 与 RenderPlan；全程未手写或后改 Timeline。Fake TTS WAV 按 Timeline.narration 的帧区间装配，字幕由 Timeline.subtitles 导出 SRT，并以中文 `mov_text` 字幕轨写入 MP4。

最终媒体实测：1280×720、30 FPS、660 Frames、22.000 秒、H.264、AAC、0 blank frames，音视频时长差 0 秒。Blank Gate 逐帧解码最终 PNG 并读取 RGBA；最低非透明像素为 858007，最低非黑像素为 858006，均远高于 1% 阈值。7 个关键帧的 RGBA SHA-256 已固化。

旁白装配使用统一的严格 PCM16 WAV Decoder。源音频不足、采样率/声道不符或旁白越过 Timeline 均立即失败，不允许静默截断。

可提交的 `frozen/` 保存 RenderPlan Golden、Preflight Golden、完整 Gate Report 与 Artifact Manifest。Manifest 固定 Story/DirectorPlan/Preflight/AssetCatalog/RenderPlan/MP4 Hash 和媒体参数；MP4 本体由 Git LFS、Release 或对象存储承载。

冻结产物：`output/m2-vertical-slice-22s.mp4`，SHA-256 为 `0dc2f9543b3c17e18b1a17baab51809983a38e4d760860c12a88e3c49326bd16`。

已知非阻塞视觉限制：基础 Follow Camera 以角色 Foot World Position 为中心；现有四层环境素材在部分大幅 Camera Follow 位置会露出图层边界。该问题属于后续 Camera Composition / Environment Coverage 质量优化，不改变 M2 自动纵向闭环结论。
