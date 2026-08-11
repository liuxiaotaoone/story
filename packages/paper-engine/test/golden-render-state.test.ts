import {describe, expect, it} from 'vitest';
import {evaluateFrame, prepareRenderPlan} from '../src/index.js';
import frame003 from './golden-v2/frame-003.json' with {type: 'json'};
import frame004 from './golden-v2/frame-004.json' with {type: 'json'};
import frame005 from './golden-v2/frame-005.json' with {type: 'json'};
import frame019 from './golden-v2/frame-019.json' with {type: 'json'};
import frame020 from './golden-v2/frame-020.json' with {type: 'json'};
import frame021 from './golden-v2/frame-021.json' with {type: 'json'};
import frame029 from './golden-v2/frame-029.json' with {type: 'json'};
import frame030 from './golden-v2/frame-030.json' with {type: 'json'};
import frame031 from './golden-v2/frame-031.json' with {type: 'json'};
import frame049 from './golden-v2/frame-049.json' with {type: 'json'};
import frame050 from './golden-v2/frame-050.json' with {type: 'json'};
import frame051 from './golden-v2/frame-051.json' with {type: 'json'};
import frame079 from './golden-v2/frame-079.json' with {type: 'json'};
import frame080 from './golden-v2/frame-080.json' with {type: 'json'};
import frame081 from './golden-v2/frame-081.json' with {type: 'json'};
import frame089 from './golden-v2/frame-089.json' with {type: 'json'};
import frame090 from './golden-v2/frame-090.json' with {type: 'json'};
import frame091 from './golden-v2/frame-091.json' with {type: 'json'};
import {goldenFixtureV2} from './fixture.js';

const GOLDENS = new Map<number, unknown>([
  [3, frame003], [4, frame004], [5, frame005],
  [19, frame019], [20, frame020], [21, frame021],
  [29, frame029], [30, frame030], [31, frame031],
  [49, frame049], [50, frame050], [51, frame051],
  [79, frame079], [80, frame080], [81, frame081],
  [89, frame089], [90, frame090], [91, frame091],
]);

const prepared = prepareRenderPlan(goldenFixtureV2);

describe('RenderState Golden JSON V2', () => {
  for (const [frame, golden] of GOLDENS) {
    it(`matches the complete frame ${frame} RenderState`, () => {
      expect(evaluateFrame(prepared, frame)).toEqual(golden);
    });
  }
});
