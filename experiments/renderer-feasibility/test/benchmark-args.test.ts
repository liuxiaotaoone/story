import {describe, expect, it} from 'vitest';
import {parseBenchmarkArgs} from '../scripts/benchmark-args.mjs';

describe('benchmark CLI contract', () => {
  it('requires --skip-ffmpeg when accepting an external FFmpeg duration', () => {
    expect(() => parseBenchmarkArgs(['--mode=gpu', '--ffmpeg-ms=761'])).toThrow(
      '--ffmpeg-ms requires --skip-ffmpeg',
    );
  });

  it('accepts an external duration only for a skipped in-process FFmpeg run', () => {
    expect(parseBenchmarkArgs(['--mode=gpu', '--skip-ffmpeg', '--ffmpeg-ms=761'])).toEqual({
      mode: 'gpu',
      skipFfmpeg: true,
      externalFfmpegMs: 761,
    });
  });
});
