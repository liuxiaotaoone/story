import type {Timeline} from '@pose-clip/schemas';

function assTime(frame: number, fps: number): string {
  const centiseconds = Math.round(frame * 100 / fps);
  const hours = Math.floor(centiseconds / 360_000);
  const minutes = Math.floor(centiseconds % 360_000 / 6_000);
  const seconds = Math.floor(centiseconds % 6_000 / 100);
  const fraction = centiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(fraction).padStart(2, '0')}`;
}

function escapeAss(text: string): string {
  return text.replaceAll('\\', '\\\\').replaceAll('{', '\\{').replaceAll('}', '\\}').replaceAll('\n', '\\N');
}

export function timelineToAss(timeline: Timeline): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Microsoft YaHei,42,&H00FFFFFF,&H000000FF,&H001A120A,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,0,2,80,80,42,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  const events = timeline.subtitles.map(cue =>
    `Dialogue: 0,${assTime(cue.range.startFrame, timeline.fps)},${assTime(cue.range.endFrame, timeline.fps)},Default,,0,0,0,,${escapeAss(cue.text)}`,
  );
  return `${header}\n${events.join('\n')}\n`;
}
