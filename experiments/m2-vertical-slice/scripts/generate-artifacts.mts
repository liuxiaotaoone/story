import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {promisify} from 'node:util';
import {generateFakeTts} from '@pose-clip/audio';
import {
  compileFinal, compilePreflight, createEffectiveDirectorPlan, hashResolvedAssetCatalogPayload,
} from '@pose-clip/compiler';
import {
  DirectorPlanSchema, StorySchema, canonicalHash, semanticRenderPlanHash,
  type AssetRecord, type CapabilityCatalog, type PoseAnchors, type ResolvedAssetCatalog,
} from '@pose-clip/schemas';
import {assembleNarrationWav, timelineToSrt} from '../src/timeline-media.ts';

const root = resolve(import.meta.dirname, '..');
const assetRoot = resolve(root, '..', 'asset-feasibility');
const generated = resolve(root, 'generated');
const artifacts = resolve(generated, 'artifacts');
const audioRoot = resolve(artifacts, 'tts');
const visualRoot = resolve(artifacts, 'visual');
const runFile = promisify(execFile);
const HASH_ZERO = '0'.repeat(64);
const transform = {position: {x: 0, y: 0}, scale: {x: 1, y: 1}, rotation: 0, opacity: 1};

const story = StorySchema.parse({
  schemaVersion: '1.0.0', id: 'story.waiting-rabbit.m2', title: '守株待兔', language: 'zh-CN', domain: 'fable',
  synopsis: '兔子撞上树桩，农夫发现了它。',
  characters: [
    {id: 'farmer', entityType: 'farmer', description: '田边劳作的农夫。', traits: ['observant']},
    {id: 'rabbit', entityType: 'rabbit', description: '慌忙奔跑的兔子。', traits: ['hurried']},
  ],
  beats: [
    {id: 'beat-run', summary: '兔子从远处跑向树桩。', participantIds: ['rabbit']},
    {id: 'beat-notice', summary: '农夫发现撞树的兔子。', participantIds: ['rabbit', 'farmer']},
  ],
});
const sourceStoryHash = await canonicalHash('story-v1', story);
const directorPlan = DirectorPlanSchema.parse({
  schemaVersion: '1.0.0', projectId: 'waiting-rabbit-m2-vertical', storyId: story.id, sourceStoryHash,
  storyBible: {title: story.title, summary: story.synopsis, styleGuideId: 'warm-paper-cut'},
  characters: [
    {characterId: 'farmer', entityType: 'farmer', role: 'observer', initialBlocking: {horizontal: 'left', depth: 'ground'}},
    {characterId: 'rabbit', entityType: 'rabbit', role: 'runner', initialBlocking: {horizontal: 'far-right', depth: 'ground'}},
  ],
  scenes: [{id: 'scene-field', sourceBeatIds: ['beat-run', 'beat-notice'], environmentIntent: 'pastoral-field', summary: '田野与老树桩。'}],
  shots: [
    {id: 'shot-run', sceneId: 'scene-field', shotType: 'wide', focusEntityId: 'rabbit', durationPreference: {preferredSeconds: 12}},
    {id: 'shot-notice', sceneId: 'scene-field', shotType: 'medium', focusEntityId: 'farmer', durationPreference: {preferredSeconds: 10}},
  ],
  narration: [
    {id: 'narration-run', sceneId: 'scene-field', shotId: 'shot-run', sequence: 0, text: '一只兔子慌忙地穿过田野。它一头撞在了老树桩上！', voiceId: 'narrator', language: 'zh-CN', speed: 1},
    {id: 'narration-notice', sceneId: 'scene-field', shotId: 'shot-notice', sequence: 0, text: '正在田边劳作的农夫听见响声，转身发现了倒下的兔子。', voiceId: 'narrator', language: 'zh-CN', speed: 1},
  ],
  actions: [
    {id: 'action-run', sceneId: 'scene-field', shotId: 'shot-run', actorId: 'rabbit', action: 'run', sequence: 0, direction: 'left', priority: 'required', enabled: true, durationPreference: {preferredSeconds: 4}, destinationBlocking: {horizontal: 'left', depth: 'ground', facing: 'left'}},
    {id: 'action-notice', sceneId: 'scene-field', shotId: 'shot-notice', actorId: 'farmer', action: 'notice', sequence: 0, direction: 'right', priority: 'required', enabled: true},
  ],
  cameraIntents: [
    {id: 'camera-run', sceneId: 'scene-field', shotId: 'shot-run', type: 'follow', focusEntityId: 'rabbit'},
    {id: 'camera-notice', sceneId: 'scene-field', shotId: 'shot-notice', type: 'pan-left', focusEntityId: 'farmer'},
  ],
  blockingIntents: [
    {id: 'blocking-rabbit', sceneId: 'scene-field', shotId: 'shot-run', characterId: 'rabbit', blocking: {horizontal: 'far-right', depth: 'ground'}},
    {id: 'blocking-farmer', sceneId: 'scene-field', shotId: 'shot-notice', characterId: 'farmer', blocking: {horizontal: 'left', depth: 'ground'}},
  ],
});

const capabilityCatalog: CapabilityCatalog = {
  schemaVersion: '1.0.0', catalogVersion: '1.0.0',
  entityCapabilities: [{
    entityType: 'rabbit', visualAssetKind: 'animal-frame', poseClips: ['rabbit.run-left'], attachmentSlots: [],
    actions: [{action: 'run', requiredPoseClips: ['rabbit.run-left'], poseBindings: [{direction: 'left', poseClipId: 'rabbit.run-left'}], targetPolicy: 'none', minDurationFrames: 12, supportsDirections: ['left'], defaultDirection: 'left', completionPolicy: 'return-default', spatialMode: 'locomotion'}],
  }, {
    entityType: 'farmer', visualAssetKind: 'character-frame', poseClips: ['farmer.notice-right'], attachmentSlots: [],
    actions: [{action: 'notice', requiredPoseClips: ['farmer.notice-right'], poseBindings: [{direction: 'right', poseClipId: 'farmer.notice-right'}], targetPolicy: 'none', minDurationFrames: 15, supportsDirections: ['right'], defaultDirection: 'right', completionPolicy: 'hold', spatialMode: 'stationary'}],
  }],
  cameraCapabilities: [
    {intent: 'follow', minDurationFrames: 30, allowedShotTypes: ['wide']},
    {intent: 'pan-left', minDurationFrames: 30, allowedShotTypes: ['medium']},
  ],
  environmentCapabilities: [{environmentId: 'pastoral-field', allowedEntityTypes: ['farmer', 'rabbit'], supportedDepthIntents: ['ground']}],
  fallbackRules: [],
};

type PackageAsset = {file: string; contentHash: string; width: number; height: number; qaStatus: string; provenance: AssetRecord['provenance']};
const packageJson = JSON.parse(await readFile(resolve(assetRoot, 'manifests', 'compiled-asset-package.json'), 'utf8')) as {assets: PackageAsset[]; packageHash: string};
const packageAssets = new Map(packageJson.assets.map(asset => [asset.file, asset]));
const anchors = async (file: string): Promise<PoseAnchors> => (JSON.parse(await readFile(resolve(assetRoot, file), 'utf8')) as {anchors: PoseAnchors}).anchors;
const visual = (id: string, kind: 'environment-layer' | 'character-frame' | 'animal-frame', file: string, alphaMode: 'opaque' | 'straight' = 'straight'): AssetRecord => {
  const asset = packageAssets.get(file);
  if (asset === undefined) throw new Error(`Compiled asset package missing ${file}`);
  return {id, kind, uri: `/asset-source/${file}`, contentHash: asset.contentHash, source: 'generated', provenance: asset.provenance, qaStatus: asset.qaStatus === 'passed' ? 'passed' : 'warning', width: asset.width, height: asset.height, alphaMode};
};

const adaptWholeBodyVisual = async (
  id: string,
  kind: 'character-frame' | 'animal-frame',
  file: string,
  scale: number,
): Promise<AssetRecord> => {
  const source = packageAssets.get(file);
  if (source === undefined) throw new Error(`Compiled asset package missing ${file}`);
  const filename = `${id}.png`;
  const output = resolve(visualRoot, filename);
  const ffmpeg = process.env.POSE_CLIP_FFMPEG ?? 'ffmpeg';
  await runFile(ffmpeg, [
    '-y', '-hide_banner', '-loglevel', 'error', '-i', resolve(assetRoot, file),
    '-vf', `scale=iw*${scale}:ih*${scale}:flags=lanczos`, output,
  ]);
  const bytes = await readFile(output);
  return {
    id,
    kind,
    uri: `/artifacts/visual/${filename}`,
    contentHash: createHash('sha256').update(bytes).digest('hex'),
    source: 'generated',
    provenance: {
      inputHash: source.contentHash,
      producer: {name: 'm2-asset-adapter', version: '1.0.0'},
      createdAt: '2026-08-12T00:00:00.000Z',
    },
    qaStatus: source.qaStatus === 'passed' ? 'passed' : 'warning',
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
    alphaMode: 'straight',
  };
};

await mkdir(audioRoot, {recursive: true});
await mkdir(visualRoot, {recursive: true});
const effectiveDirectorPlan = await createEffectiveDirectorPlan({story, directorPlan, overrides: []});
const preflight = await compilePreflight({effectiveDirectorPlan, capabilityCatalog});
const ttsArtifacts = await Promise.all(preflight.ttsRequests.map(async request => {
  const uri = `artifacts/tts/${request.id}.wav`;
  const result = await generateFakeTts(request, uri);
  await writeFile(resolve(generated, uri), result.wavBytes);
  return result;
}));
const adaptedVisuals = await Promise.all([
  adaptWholeBodyVisual('farmer-idle', 'character-frame', 'normalized/farmer/idle.png', 0.205),
  adaptWholeBodyVisual('farmer-notice-right', 'character-frame', 'normalized/farmer/notice-right.png', 0.205),
  adaptWholeBodyVisual('rabbit-idle-left', 'animal-frame', 'normalized/rabbit/idle-left.png', 0.18),
  ...[1, 2, 3, 4].map(number => adaptWholeBodyVisual(
    `rabbit-run-${number}`,
    'animal-frame',
    `normalized/rabbit/run-left-0${number}.png`,
    0.18,
  )),
]);

const poseClips = [{
  id: 'rabbit.idle-left', entityType: 'rabbit', action: 'idle', loop: true, direction: 'left' as const,
  frames: [{assetId: 'rabbit-idle-left', durationFrames: 30, anchors: await anchors('anchors/rabbit/idle-left.json'), contact: {type: 'both' as const}, referenceFoot: 'midpoint' as const}],
  rootMotion: {mode: 'timeline' as const}, groundLock: {mode: 'always' as const, maxCorrectionPx: 8},
}, {
  id: 'rabbit.run-left', entityType: 'rabbit', action: 'run', loop: true, direction: 'left' as const,
  frames: await Promise.all([1, 2, 3, 4].map(async number => ({
    assetId: `rabbit-run-${number}`, durationFrames: 3,
    anchors: await anchors(`anchors/rabbit/run-left-0${number}.json`),
    contact: {type: number % 2 === 1 ? 'left-foot' as const : 'right-foot' as const},
    referenceFoot: number % 2 === 1 ? 'left-foot' as const : 'right-foot' as const,
  }))),
  rootMotion: {mode: 'timeline' as const}, groundLock: {mode: 'contact-only' as const, maxCorrectionPx: 48},
}, {
  id: 'farmer.idle', entityType: 'farmer', action: 'idle', loop: true, direction: 'front' as const,
  frames: [{assetId: 'farmer-idle', durationFrames: 30, anchors: await anchors('anchors/farmer/idle.json'), contact: {type: 'both' as const}, referenceFoot: 'midpoint' as const}],
  rootMotion: {mode: 'timeline' as const}, groundLock: {mode: 'always' as const, maxCorrectionPx: 8},
}, {
  id: 'farmer.notice-right', entityType: 'farmer', action: 'notice', loop: true, direction: 'right' as const,
  frames: [{assetId: 'farmer-notice-right', durationFrames: 30, anchors: await anchors('anchors/farmer/notice-right.json'), contact: {type: 'both' as const}, referenceFoot: 'midpoint' as const}],
  rootMotion: {mode: 'timeline' as const}, groundLock: {mode: 'always' as const, maxCorrectionPx: 8},
}];

const catalogPayload: Omit<ResolvedAssetCatalog, 'catalogHash'> = {
  schemaVersion: '1.0.0', mode: 'experiment', productionReady: false,
  assets: {schemaVersion: '1.0.0', assets: [
    visual('environment-far', 'environment-layer', 'processed/environment/far.png', 'opaque'),
    visual('environment-mid', 'environment-layer', 'processed/environment/mid.png'),
    visual('environment-ground', 'environment-layer', 'processed/environment/ground.png'),
    visual('environment-foreground', 'environment-layer', 'processed/environment/foreground.png'),
    ...adaptedVisuals,
    ...ttsArtifacts.map(({artifact}) => artifact.asset),
  ]},
  poseClips,
  environments: [{
    id: 'pastoral-field', name: 'Pastoral Field', referenceResolution: {width: 1280, height: 720},
    layers: [
      {id: 'far', assetId: 'environment-far', renderLayer: 'far', zIndex: 0, parallaxFactor: 0.1, transform},
      {id: 'mid', assetId: 'environment-mid', renderLayer: 'mid', zIndex: 0, parallaxFactor: 0.35, transform},
      {id: 'ground', assetId: 'environment-ground', renderLayer: 'ground', zIndex: 0, parallaxFactor: 0.7, transform},
      {id: 'foreground', assetId: 'environment-foreground', renderLayer: 'foreground', zIndex: 0, parallaxFactor: 1.15, transform},
    ],
    ground: {farLeft: {x: 0.05, y: 0.58}, farRight: {x: 0.95, y: 0.58}, nearLeft: {x: 0, y: 0.96}, nearRight: {x: 1, y: 0.96}, farScale: 0.55, nearScale: 1, depthEasing: 'linear', walkableZones: []},
    occlusionZones: [],
  }],
  entityDefinitions: [
    {id: 'rabbit-definition', entityType: 'rabbit', displayName: 'Rabbit', poseClipIds: ['rabbit.idle-left', 'rabbit.run-left'], defaultPoseClipId: 'rabbit.idle-left', attachmentSlots: []},
    {id: 'farmer-definition', entityType: 'farmer', displayName: 'Farmer', poseClipIds: ['farmer.idle', 'farmer.notice-right'], defaultPoseClipId: 'farmer.idle', attachmentSlots: []},
  ],
  characterBindings: [{characterId: 'rabbit', entityDefinitionId: 'rabbit-definition'}, {characterId: 'farmer', entityDefinitionId: 'farmer-definition'}],
};
const assetCatalog = {...catalogPayload, catalogHash: await hashResolvedAssetCatalogPayload(catalogPayload)};
const renderPlan = await compileFinal({
  effectiveDirectorPlan, preflight, measuredAudio: ttsArtifacts.map(({artifact}) => artifact.measuredAudio),
  capabilityCatalog, assetCatalog,
  context: {seed: 20260812, compilerVersion: '0.1.0', compiledAt: '2026-08-12T00:00:00.000Z'},
});
const narrationMaster = assembleNarrationWav({timeline: renderPlan.timeline, wavByAssetId: new Map(ttsArtifacts.map(result => [result.artifact.asset.id, result.wavBytes]))});
const renderPlanHash = await semanticRenderPlanHash(renderPlan);
await writeFile(resolve(artifacts, 'story.json'), `${JSON.stringify(story, null, 2)}\n`);
await writeFile(resolve(artifacts, 'director-plan.json'), `${JSON.stringify(directorPlan, null, 2)}\n`);
await writeFile(resolve(artifacts, 'preflight.json'), `${JSON.stringify(preflight, null, 2)}\n`);
await writeFile(resolve(artifacts, 'render-plan.json'), `${JSON.stringify(renderPlan, null, 2)}\n`);
await writeFile(resolve(artifacts, 'subtitles.srt'), timelineToSrt(renderPlan.timeline));
await writeFile(resolve(artifacts, 'narration-master.wav'), narrationMaster);
await writeFile(resolve(artifacts, 'generation-report.json'), `${JSON.stringify({
  sourceStoryHash, sourceDirectorPlanHash: effectiveDirectorPlan.sourceDirectorPlanHash,
  effectiveDirectorPlanHash: effectiveDirectorPlan.effectivePlanHash,
  preflightHash: preflight.preflightHash, assetCatalogHash: assetCatalog.catalogHash,
  renderPlanSemanticHash: renderPlanHash, fps: renderPlan.timeline.fps,
  frameCount: renderPlan.timeline.durationFrames,
  durationSeconds: renderPlan.timeline.durationFrames / renderPlan.timeline.fps,
  media: {
    width: renderPlan.project.resolution.width,
    height: renderPlan.project.resolution.height,
    fps: renderPlan.timeline.fps,
    frameCount: renderPlan.timeline.durationFrames,
    durationSeconds: renderPlan.timeline.durationFrames / renderPlan.timeline.fps,
  },
  timelineAuthorship: 'final-compiler-only', fakeTts: true,
}, null, 2)}\n`);
process.stdout.write(`M2 generated artifacts: ${artifacts}\n`);
