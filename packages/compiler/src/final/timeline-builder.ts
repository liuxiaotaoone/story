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
import {compileInteractionTimeline} from './visual-planning-compiler.js';

export function compileActionPoseEvents(input: {
  effective: EffectiveDirectorPlan;
  preflight: PreflightCompileResult;
  timing: SolvedTimingPlan;
  catalog: ResolvedAssetCatalog;
}): Pick<Timeline, 'poseEvents' | 'poseTransitions'> {
  const definitions = new Map(input.catalog.entityDefinitions.map(definition => [definition.id, definition]));
  const bindings = new Map(input.catalog.characterBindings.map(binding => [binding.characterId, binding.entityDefinitionId]));
  const defaultPose = new Map(input.effective.plan.characters.map(character => {
    const definition = definitions.get(bindings.get(character.characterId)!)!;
    return [character.characterId, definition.defaultPoseClipId] as const;
  }));
  const actions = new Map(input.preflight.expandedActions.map(action => [action.id, action]));
  const poseEvents: Timeline['poseEvents'] = [];
  const poseTransitions: Timeline['poseTransitions'] = [];
  const solvedActions = input.timing.shots.flatMap(shot => shot.actions).map(solved => ({
    solved,
    action: actions.get(solved.expandedActionId)!,
  }));
  for (const character of input.effective.plan.characters) {
    const actorActions = solvedActions
      .filter(item => item.action.actorId === character.characterId)
      .sort((left, right) => left.solved.startFrame - right.solved.startFrame || left.action.id.localeCompare(right.action.id));
    let activePose = defaultPose.get(character.characterId)!;
    for (const [index, item] of actorActions.entries()) {
      const {solved, action} = item;
      const previousItem = actorActions[index - 1];
      if (previousItem !== undefined
        && previousItem.action.completionPolicy === 'return-default'
        && previousItem.solved.endFrame < solved.startFrame
        && previousItem.solved.endFrame < input.timing.durationFrames) {
        const fallback = defaultPose.get(character.characterId)!;
        if (activePose !== fallback) {
          poseEvents.push({
            id: `pose-complete.${previousItem.action.id}`, frame: previousItem.solved.endFrame,
            entityId: character.characterId, poseClipId: fallback, clipStartOffset: 0, playbackRate: 1,
          });
          poseTransitions.push({
            id: `pose-transition-complete.${previousItem.action.id}`, entityId: character.characterId,
            fromPoseClipId: activePose, toPoseClipId: fallback,
            startFrame: previousItem.solved.endFrame, durationFrames: 0, mode: 'cut', anchorPolicy: 'foot',
          });
          activePose = fallback;
        }
      }
      poseEvents.push({
        id: `pose.${action.id}`, frame: solved.startFrame, entityId: action.actorId,
        poseClipId: action.poseClipId, clipStartOffset: 0, playbackRate: 1,
      });
      if (activePose !== action.poseClipId) {
        poseTransitions.push({
          id: `pose-transition.${action.id}`, entityId: action.actorId,
          fromPoseClipId: activePose, toPoseClipId: action.poseClipId,
          startFrame: solved.startFrame, durationFrames: 0, mode: 'cut', anchorPolicy: 'foot',
        });
      }
      activePose = action.poseClipId;
    }
    const last = actorActions.at(-1);
    if (last !== undefined
      && last.action.completionPolicy === 'return-default'
      && last.solved.endFrame < input.timing.durationFrames) {
      const fallback = defaultPose.get(character.characterId)!;
      if (activePose !== fallback) {
        poseEvents.push({
          id: `pose-complete.${last.action.id}`, frame: last.solved.endFrame,
          entityId: character.characterId, poseClipId: fallback, clipStartOffset: 0, playbackRate: 1,
        });
        poseTransitions.push({
          id: `pose-transition-complete.${last.action.id}`, entityId: character.characterId,
          fromPoseClipId: activePose, toPoseClipId: fallback,
          startFrame: last.solved.endFrame, durationFrames: 0, mode: 'cut', anchorPolicy: 'foot',
        });
      }
    }
  }
  poseEvents.sort((left, right) => left.frame - right.frame || left.entityId.localeCompare(right.entityId) || left.id.localeCompare(right.id));
  poseTransitions.sort((left, right) => left.startFrame - right.startFrame || left.entityId.localeCompare(right.entityId) || left.id.localeCompare(right.id));
  return {poseEvents, poseTransitions};
}

export function compileEntityTracks(
  effective: EffectiveDirectorPlan,
  preflight: PreflightCompileResult,
  timing: SolvedTimingPlan,
  catalog?: ResolvedAssetCatalog,
): Timeline['entityTracks'] {
  const expandedActions = new Map(preflight.expandedActions.map(action => [action.id, action]));
  const characterTracks = effective.plan.characters.map(character => {
    const points: NonNullable<Timeline['entityTracks'][number]['groundPosition']> = [];
    const upsert = (frame: number, value: ReturnType<typeof compileBlockingIntent>, easing: 'hold' | 'linear'): void => {
      const index = points.findIndex(point => point.frame === frame);
      const keyframe = {frame, value, easing};
      if (index === -1) points.push(keyframe);
      else points[index] = keyframe;
      points.sort((left, right) => left.frame - right.frame);
    };
    upsert(0, compileBlockingIntent(character.initialBlocking), 'hold');
    for (const shotTiming of timing.shots) {
      const blocking = effective.plan.blockingIntents.find(intent =>
        intent.shotId === shotTiming.shotId && intent.characterId === character.characterId);
      if (blocking !== undefined) upsert(shotTiming.startFrame, compileBlockingIntent(blocking.blocking), 'hold');
      for (const solved of shotTiming.actions) {
        const action = expandedActions.get(solved.expandedActionId)!;
        if (action.actorId !== character.characterId || action.spatialMode !== 'locomotion') continue;
        const destination = compileBlockingIntent(action.destinationBlocking!);
        const start = points.filter(point => point.frame <= solved.startFrame).at(-1)?.value
          ?? compileBlockingIntent(character.initialBlocking);
        upsert(solved.startFrame, start, 'linear');
        upsert(solved.endFrame, destination, 'hold');
      }
    }
    return {entityId: character.characterId, groundPosition: points};
  });
  const landmarkTracks: Timeline['entityTracks'] = (effective.plan.landmarks ?? []).map(landmark => {
    if (catalog !== undefined && !catalog.landmarkBindings?.some(binding => binding.landmarkType === landmark.landmarkType)) {
      throw new Error(`No resolved landmark binding for ${landmark.landmarkType}`);
    }
    return {entityId: landmark.id, groundPosition: [{frame: 0, value: compileBlockingIntent(landmark.blocking), easing: 'hold'}]};
  });
  return [...characterTracks, ...landmarkTracks];
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
  const actionOutput = compileActionPoseEvents(input);
  const narrationOutput = narrationCues(input);
  const baseEntityTracks = compileEntityTracks(input.effective, input.preflight, input.timing, input.catalog);
  const interactionOutput = compileInteractionTimeline({
    effective: input.effective, preflight: input.preflight, timing: input.timing,
    catalog: input.catalog, baseTracks: baseEntityTracks,
  });
  const compiledEntityTracks = interactionOutput.entityTracks;
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
    entityTracks: compiledEntityTracks,
    cameraTracks: input.timing.shots.map(timing => {
      const shot = shots.get(timing.shotId)!;
      const intent = cameraIntents.get(timing.shotId)!;
      const scene = scenes.get(shot.sceneId)!;
      const focusEntityTrack = shot.focusEntityId === undefined
        ? undefined
        : compiledEntityTracks.find(track => track.entityId === shot.focusEntityId);
      return compileCameraTrack({
        intent, shotType: shot.shotType, timing,
        ...(shot.focusEntityId === undefined ? {} : {focusEntityId: shot.focusEntityId}),
        ...(shot.composition === undefined ? {} : {composition: shot.composition}),
        ...(focusEntityTrack === undefined ? {} : {focusEntityTrack}),
        environment: input.catalog.environments.find(environment => environment.id === scene.environmentIntent)!,
      });
    }),
    ...actionOutput,
    ownershipEvents: interactionOutput.ownershipEvents,
    visibilityEvents: interactionOutput.visibilityEvents,
    effectEvents: interactionOutput.effectEvents,
    ...narrationOutput,
    sfx: [],
    transitions: input.timing.shots.slice(1).map((timing, index) => ({
      id: `shot-transition.${timing.shotId}`,
      fromShotId: input.timing.shots[index]!.shotId,
      toShotId: timing.shotId,
      type: 'cut' as const,
      frame: timing.startFrame,
    })),
    markers: interactionOutput.markers,
  });
}
