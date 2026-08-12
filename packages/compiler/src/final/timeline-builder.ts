import {
  TimelineSchema,
  type EffectiveDirectorPlan,
  type MeasuredAudio,
  type PreflightCompileResult,
  type ResolvedAssetCatalog,
  type Timeline,
} from '@pose-clip/schemas';
import {compileBlockingIntent} from './blocking-compiler.js';
import {compileCameraTrack} from './camera-compiler.js';
import type {SolvedTimingPlan} from '../timing/types.js';

function actionEvents(input: {
  effective: EffectiveDirectorPlan;
  preflight: PreflightCompileResult;
  timing: SolvedTimingPlan;
  catalog: ResolvedAssetCatalog;
}): Pick<Timeline, 'poseEvents' | 'poseTransitions'> {
  const definitions = new Map(input.catalog.entityDefinitions.map(definition => [definition.id, definition]));
  const bindings = new Map(input.catalog.characterBindings.map(binding => [binding.characterId, binding.entityDefinitionId]));
  const activePose = new Map(input.effective.plan.characters.map(character => {
    const definition = definitions.get(bindings.get(character.characterId)!)!;
    return [character.characterId, definition.defaultPoseClipId] as const;
  }));
  const actions = new Map(input.preflight.expandedActions.map(action => [action.id, action]));
  const poseEvents: Timeline['poseEvents'] = [];
  const poseTransitions: Timeline['poseTransitions'] = [];
  for (const shot of input.timing.shots) {
    for (const solved of shot.actions) {
      const action = actions.get(solved.expandedActionId)!;
      const previous = activePose.get(action.actorId)!;
      poseEvents.push({
        id: `pose.${action.id}`, frame: solved.startFrame, entityId: action.actorId,
        poseClipId: action.poseClipId, clipStartOffset: 0, playbackRate: 1,
      });
      if (previous !== action.poseClipId) {
        poseTransitions.push({
          id: `pose-transition.${action.id}`, entityId: action.actorId,
          fromPoseClipId: previous, toPoseClipId: action.poseClipId,
          startFrame: solved.startFrame, durationFrames: 0, mode: 'cut', anchorPolicy: 'foot',
        });
      }
      activePose.set(action.actorId, action.poseClipId);
    }
  }
  return {poseEvents, poseTransitions};
}

function entityTracks(effective: EffectiveDirectorPlan, timing: SolvedTimingPlan): Timeline['entityTracks'] {
  const shotTiming = new Map(timing.shots.map(shot => [shot.shotId, shot]));
  return effective.plan.characters.map(character => {
    const points = effective.plan.blockingIntents
      .filter(blocking => blocking.characterId === character.characterId)
      .map(blocking => ({
        frame: shotTiming.get(blocking.shotId)!.startFrame,
        value: compileBlockingIntent(blocking.blocking),
        easing: 'hold' as const,
      }))
      .sort((left, right) => left.frame - right.frame);
    if (points[0]?.frame !== 0) points.unshift({
      frame: 0, value: compileBlockingIntent(character.initialBlocking), easing: 'hold',
    });
    return {entityId: character.characterId, groundPosition: points};
  });
}

function narrationCues(input: {
  preflight: PreflightCompileResult;
  measuredAudio: readonly MeasuredAudio[];
  timing: SolvedTimingPlan;
}): Pick<Timeline, 'narration' | 'subtitles'> {
  const segments = new Map(input.preflight.narrationSegments.map(segment => [segment.id, segment]));
  const audio = new Map(input.measuredAudio.map(measured => [measured.requestId, measured]));
  const narration: Timeline['narration'] = [];
  const subtitles: Timeline['subtitles'] = [];
  for (const shot of input.timing.shots) {
    for (const solved of shot.narration) {
      const segment = segments.get(solved.segmentId)!;
      const measured = audio.get(solved.ttsRequestId)!;
      const range = {startFrame: solved.startFrame, endFrame: solved.endFrame};
      narration.push({
        id: `narration.${segment.id}`, range, assetId: solved.audioAssetId, text: segment.text,
        sampleStart: 0, sampleLength: measured.sampleFrameCount,
      });
      subtitles.push({id: `subtitle.${segment.id}`, range, text: segment.text, styleId: 'subtitle.default'});
    }
  }
  return {narration, subtitles};
}

export function buildCanonicalTimeline(input: {
  effective: EffectiveDirectorPlan;
  preflight: PreflightCompileResult;
  measuredAudio: readonly MeasuredAudio[];
  timing: SolvedTimingPlan;
  catalog: ResolvedAssetCatalog;
}): Timeline {
  const scenes = new Map(input.effective.plan.scenes.map(scene => [scene.id, scene]));
  const shots = new Map(input.effective.plan.shots.map(shot => [shot.id, shot]));
  const cameraIntents = new Map(input.effective.plan.cameraIntents.map(intent => [intent.shotId, intent]));
  const actionOutput = actionEvents(input);
  const narrationOutput = narrationCues(input);
  return TimelineSchema.parse({
    schemaVersion: '1.0.0', fps: 30, durationFrames: input.timing.durationFrames,
    shots: input.timing.shots.map(timing => {
      const shot = shots.get(timing.shotId)!;
      const scene = scenes.get(shot.sceneId)!;
      return {
        id: shot.id, sceneId: shot.sceneId, environmentId: scene.environmentIntent,
        range: {startFrame: timing.startFrame, endFrame: timing.endFrame},
        ...(shot.focusEntityId === undefined ? {} : {focusEntityId: shot.focusEntityId}),
      };
    }),
    entityTracks: entityTracks(input.effective, input.timing),
    cameraTracks: input.timing.shots.map(timing => {
      const shot = shots.get(timing.shotId)!;
      return compileCameraTrack({intent: cameraIntents.get(timing.shotId)!, shotType: shot.shotType, timing});
    }),
    ...actionOutput,
    ownershipEvents: [], visibilityEvents: [], effectEvents: [],
    ...narrationOutput,
    sfx: [],
    transitions: input.timing.shots.slice(1).map((timing, index) => ({
      id: `shot-transition.${timing.shotId}`,
      fromShotId: input.timing.shots[index]!.shotId,
      toShotId: timing.shotId,
      type: 'cut' as const,
      frame: timing.startFrame,
    })),
    markers: [],
  });
}
