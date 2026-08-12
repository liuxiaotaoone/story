import {evaluateFrame, prepareRenderPlan} from '@pose-clip/paper-engine';
import {RenderPlanSchema, RenderStateSchema} from '@pose-clip/schemas';
import {describe, expect, it} from 'vitest';
import {createRendererFeasibilityPlan} from '../src/render-plan.js';

describe('renderer feasibility fixture', () => {
  it('is a valid 10-second plan and evaluates critical adapter frames', () => {
    const plan = RenderPlanSchema.parse(createRendererFeasibilityPlan());
    const prepared = prepareRenderPlan(plan);
    expect(plan.timeline.durationFrames).toBe(300);
    for (const frame of [3, 20, 31, 50, 60, 79]) {
      expect(() => RenderStateSchema.parse(evaluateFrame(prepared, frame))).not.toThrow();
    }
  });

  it('keeps every renderer-determinism boundary frame evaluable after arbitrary history', () => {
    const prepared = prepareRenderPlan(RenderPlanSchema.parse(createRendererFeasibilityPlan()));
    const history = [0, 20, 31, 50, 79, 100];
    for (const target of [3, 20, 31, 50, 70, 90]) {
      for (const frame of [...history.filter(candidate => candidate !== target), target]) {
        RenderStateSchema.parse(evaluateFrame(prepared, frame));
      }
      const direct = evaluateFrame(prepared, target);
      expect(evaluateFrame(prepared, target)).toEqual(direct);
    }
  });
});
