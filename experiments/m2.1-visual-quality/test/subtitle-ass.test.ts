import {describe, expect, it} from 'vitest';
import type {Timeline} from '@pose-clip/schemas';
import {timelineToAss} from '../src/subtitle-ass.js';

describe('M2.1 ASS subtitle export', () => {
  it('uses canonical resolution and frame-derived dialogue times', () => {
    const timeline = {
      schemaVersion: '1.0.0', fps: 30, durationFrames: 90, shots: [], entityTracks: [], cameraTracks: [], poseEvents: [], poseTransitions: [], ownershipEvents: [], visibilityEvents: [], effectEvents: [], narration: [],
      subtitles: [{id: 'subtitle', range: {startFrame: 30, endFrame: 60}, text: '兔子撞上树桩。', styleId: 'default'}], sfx: [], transitions: [], markers: [],
    } as Timeline;
    const ass = timelineToAss(timeline);
    expect(ass).toContain('PlayResX: 1280');
    expect(ass).toContain('Dialogue: 0,0:00:01.00,0:00:02.00');
    expect(ass).toContain('兔子撞上树桩。');
  });
});
