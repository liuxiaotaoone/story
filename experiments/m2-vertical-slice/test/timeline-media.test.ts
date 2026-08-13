import {describe, expect, it} from 'vitest';
import {measureWav, writePcm16Wav} from '@pose-clip/audio';
import type {Timeline} from '@pose-clip/schemas';
import {assembleNarrationWav, formatSrtTimestamp, timelineToSrt} from '../src/timeline-media.js';

const timeline = {
  schemaVersion: '1.0.0', fps: 30, durationFrames: 90, shots: [], entityTracks: [], cameraTracks: [],
  poseEvents: [], poseTransitions: [], ownershipEvents: [], visibilityEvents: [], effectEvents: [],
  narration: [{id: 'n', range: {startFrame: 30, endFrame: 60}, assetId: 'audio', text: 'Hello', sampleStart: 0, sampleLength: 48_000}],
  subtitles: [{id: 's', range: {startFrame: 30, endFrame: 60}, text: 'Hello', styleId: 'default'}],
  sfx: [], transitions: [], markers: [],
} as Timeline;

describe('M2 timeline media export', () => {
  it('converts exact frame ranges to SRT time', () => {
    expect(formatSrtTimestamp(31, 30)).toBe('00:00:01,033');
    expect(timelineToSrt(timeline)).toContain('00:00:01,000 --> 00:00:02,000\nHello');
  });

  it('places narration samples on the canonical timeline and preserves silence', () => {
    const voice = writePcm16Wav({sampleRate: 48_000, channels: 1, interleavedSamples: new Int16Array(48_000).fill(1000)});
    const master = assembleNarrationWav({timeline, wavByAssetId: new Map([['audio', voice]])});
    expect(measureWav(master).sampleFrameCount).toBe(144_000);
    const view = new DataView(master.buffer, master.byteOffset, master.byteLength);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(44 + 48_000 * 2, true)).toBe(1000);
  });
});
