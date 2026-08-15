import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {promisify} from 'node:util';
import {compileFinal, compilePreflight, createEffectiveDirectorPlan, hashResolvedAssetCatalogPayload} from '@pose-clip/compiler';
import {evaluateGroundPointKeyframes, projectGround} from '@pose-clip/paper-engine';
import {
  DirectorPlanSchema,
  RenderPlanSchema,
  StorySchema,
  canonicalHash,
  semanticRenderPlanHashV1,
  type AssetRecord,
  type CapabilityCatalog,
  type PoseAnchors,
  type RenderPlan,
  type ResolvedAssetCatalog,
} from '@pose-clip/schemas';
import {assembleNarrationWav, timelineToSrt} from '../../m2-vertical-slice/src/timeline-media.ts';
import {timelineToAss} from '../src/subtitle-ass.ts';
import {createTtsProvider} from '../src/tts-providers.ts';

const runFile = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const assetRoot = resolve(root, '..', 'asset-feasibility');
const generated = resolve(root, 'generated');
const artifacts = resolve(generated, 'artifacts');
const audioRoot = resolve(artifacts, 'tts');
const visualRoot = resolve(artifacts, 'visual');
const ffmpeg = process.env.POSE_CLIP_FFMPEG ?? 'ffmpeg';
const contractOnly = process.env.M21_CONTRACT_ONLY === '1';
const transformOverscan = {position: {x: -320, y: -180}, scale: {x: 1.5, y: 1.5}, rotation: 0, opacity: 1};

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const story = StorySchema.parse({
  schemaVersion: '1.0.0', id: 'story.waiting-rabbit.m21', title: '守株待兔', language: 'zh-CN', domain: 'fable',
  synopsis: '兔子撞上树桩倒地，农夫发现后走近并抱起它。',
  characters: [
    {id: 'farmer', entityType: 'farmer', description: '在田边劳作的农夫。', traits: ['observant', 'careful']},
    {id: 'rabbit', entityType: 'rabbit', description: '慌忙奔跑的兔子。', traits: ['hurried']},
  ],
  beats: [
    {id: 'beat-collision', summary: '兔子跑过田野并撞上树桩。', participantIds: ['rabbit']},
    {id: 'beat-notice', summary: '农夫发现倒地的兔子。', participantIds: ['rabbit', 'farmer']},
    {id: 'beat-approach', summary: '农夫走到兔子身边弯腰查看。', participantIds: ['rabbit', 'farmer']},
    {id: 'beat-pickup', summary: '农夫抱起兔子。', participantIds: ['rabbit', 'farmer']},
  ],
});
const sourceStoryHash = await canonicalHash('story-v1', story);

const directorPlan = DirectorPlanSchema.parse({
  schemaVersion: '1.0.0', projectId: 'waiting-rabbit-m21-visual', storyId: story.id, sourceStoryHash,
  storyBible: {title: story.title, summary: story.synopsis, styleGuideId: 'warm-paper-cut'},
  characters: [
    {characterId: 'farmer', entityType: 'farmer', role: 'observer-and-helper', initialBlocking: {horizontal: 'left', depth: 'ground'}},
    {characterId: 'rabbit', entityType: 'rabbit', role: 'runner', initialBlocking: {horizontal: 'far-right', depth: 'ground'}},
  ],
  scenes: [{id: 'scene-field', sourceBeatIds: story.beats.map(beat => beat.id), environmentIntent: 'pastoral-field', summary: '田野、农舍与清晰可见的树桩。'}],
  shots: [
    {id: 'shot-collision', sceneId: 'scene-field', shotType: 'wide', focusEntityId: 'rabbit', durationPreference: {preferredSeconds: 6, maxSeconds: 7}},
    {id: 'shot-notice', sceneId: 'scene-field', shotType: 'wide', focusEntityId: 'farmer', durationPreference: {preferredSeconds: 4, maxSeconds: 5}},
    {id: 'shot-approach', sceneId: 'scene-field', shotType: 'wide', focusEntityId: 'farmer', durationPreference: {preferredSeconds: 4.5, maxSeconds: 5}},
    {id: 'shot-pickup', sceneId: 'scene-field', shotType: 'medium', focusEntityId: 'farmer', durationPreference: {preferredSeconds: 5, maxSeconds: 5.5}},
  ],
  narration: [
    {id: 'narration-collision', sceneId: 'scene-field', shotId: 'shot-collision', sequence: 0, text: '一只兔子慌忙穿过田野，砰的一声撞上了树桩。', voiceId: 'qwen3:Serena', language: 'zh-CN', speed: 1},
    {id: 'narration-notice', sceneId: 'scene-field', shotId: 'shot-notice', sequence: 0, text: '兔子倒在地上。农夫听见响声，转身看去。', voiceId: 'qwen3:Serena', language: 'zh-CN', speed: 1},
    {id: 'narration-approach', sceneId: 'scene-field', shotId: 'shot-approach', sequence: 0, text: '他快步走到树桩旁，弯下腰仔细查看。', voiceId: 'qwen3:Serena', language: 'zh-CN', speed: 1},
    {id: 'narration-pickup', sceneId: 'scene-field', shotId: 'shot-pickup', sequence: 0, text: '农夫伸手抱起兔子，把它稳稳搂在怀里。', voiceId: 'qwen3:Serena', language: 'zh-CN', speed: 1},
  ],
  actions: [
    {id: 'action-run', sceneId: 'scene-field', shotId: 'shot-collision', actorId: 'rabbit', action: 'run', sequence: 0, direction: 'left', priority: 'required', enabled: true, durationPreference: {preferredSeconds: 3}, destinationBlocking: {horizontal: 'right', depth: 'ground', facing: 'left'}},
    {id: 'action-collision', sceneId: 'scene-field', shotId: 'shot-collision', actorId: 'rabbit', action: 'collision', sequence: 1, direction: 'left', priority: 'required', enabled: true, durationPreference: {preferredSeconds: 0.8}},
    {id: 'action-lying', sceneId: 'scene-field', shotId: 'shot-collision', actorId: 'rabbit', action: 'lying', sequence: 2, direction: 'left', priority: 'required', enabled: true, durationPreference: {preferredSeconds: 1.2}},
    {id: 'action-notice', sceneId: 'scene-field', shotId: 'shot-notice', actorId: 'farmer', action: 'notice', sequence: 0, direction: 'right', priority: 'required', enabled: true, durationPreference: {preferredSeconds: 1.2}},
    {id: 'action-walk', sceneId: 'scene-field', shotId: 'shot-approach', actorId: 'farmer', action: 'walk', sequence: 0, direction: 'right', priority: 'required', enabled: true, durationPreference: {preferredSeconds: 3}, destinationBlocking: {horizontal: 'right', depth: 'ground', facing: 'right'}},
    {id: 'action-bend', sceneId: 'scene-field', shotId: 'shot-approach', actorId: 'farmer', action: 'bend', sequence: 1, direction: 'right', priority: 'required', enabled: true, durationPreference: {preferredSeconds: 1.2}},
    {id: 'action-pickup', sceneId: 'scene-field', shotId: 'shot-pickup', actorId: 'farmer', targetId: 'rabbit', action: 'pickup', sequence: 0, direction: 'right', priority: 'required', enabled: true, durationPreference: {preferredSeconds: 1.3}},
    {id: 'action-hold', sceneId: 'scene-field', shotId: 'shot-pickup', actorId: 'farmer', targetId: 'rabbit', action: 'hold', sequence: 1, direction: 'right', priority: 'required', enabled: true, durationPreference: {preferredSeconds: 2.5}},
  ],
  cameraIntents: [
    {id: 'camera-collision', sceneId: 'scene-field', shotId: 'shot-collision', type: 'follow', focusEntityId: 'rabbit'},
    {id: 'camera-notice', sceneId: 'scene-field', shotId: 'shot-notice', type: 'slow-push-in', focusEntityId: 'farmer'},
    {id: 'camera-approach', sceneId: 'scene-field', shotId: 'shot-approach', type: 'follow', focusEntityId: 'farmer'},
    {id: 'camera-pickup', sceneId: 'scene-field', shotId: 'shot-pickup', type: 'slow-push-in', focusEntityId: 'farmer'},
  ],
  blockingIntents: [
    {id: 'block-rabbit-collision', sceneId: 'scene-field', shotId: 'shot-collision', characterId: 'rabbit', blocking: {horizontal: 'far-right', depth: 'ground'}},
    {id: 'block-farmer-collision', sceneId: 'scene-field', shotId: 'shot-collision', characterId: 'farmer', blocking: {horizontal: 'left', depth: 'ground'}},
    {id: 'block-rabbit-notice', sceneId: 'scene-field', shotId: 'shot-notice', characterId: 'rabbit', blocking: {horizontal: 'right', depth: 'ground'}},
    {id: 'block-farmer-notice', sceneId: 'scene-field', shotId: 'shot-notice', characterId: 'farmer', blocking: {horizontal: 'left', depth: 'ground'}},
    {id: 'block-rabbit-approach', sceneId: 'scene-field', shotId: 'shot-approach', characterId: 'rabbit', blocking: {horizontal: 'right', depth: 'ground'}},
    {id: 'block-farmer-approach', sceneId: 'scene-field', shotId: 'shot-approach', characterId: 'farmer', blocking: {horizontal: 'left', depth: 'ground'}},
    {id: 'block-rabbit-pickup', sceneId: 'scene-field', shotId: 'shot-pickup', characterId: 'rabbit', blocking: {horizontal: 'right', depth: 'ground'}},
    {id: 'block-farmer-pickup', sceneId: 'scene-field', shotId: 'shot-pickup', characterId: 'farmer', blocking: {horizontal: 'right', depth: 'ground'}},
  ],
});

const capability = (action: string, poseClipId: string, direction: 'left' | 'right', minimum: number, spatialMode: 'stationary' | 'locomotion', targetTypes?: string[]) => ({
  action, requiredPoseClips: [poseClipId], poseBindings: [{direction, poseClipId}],
  targetPolicy: targetTypes === undefined ? 'none' as const : 'required' as const, minDurationFrames: minimum,
  supportsDirections: [direction], defaultDirection: direction, completionPolicy: 'hold' as const, spatialMode,
  ...(targetTypes === undefined ? {} : {targetTypes}),
});
const capabilityCatalog: CapabilityCatalog = {
  schemaVersion: '1.0.0', catalogVersion: '1.0.0',
  entityCapabilities: [{
    entityType: 'rabbit', visualAssetKind: 'animal-frame',
    poseClips: ['rabbit.run-left', 'rabbit.collision', 'rabbit.lying'], attachmentSlots: [],
    actions: [
      capability('run', 'rabbit.run-left', 'left', 30, 'locomotion'),
      capability('collision', 'rabbit.collision', 'left', 12, 'stationary'),
      capability('lying', 'rabbit.lying', 'left', 18, 'stationary'),
    ],
  }, {
    entityType: 'farmer', visualAssetKind: 'character-frame',
    poseClips: ['farmer.notice-right', 'farmer.walk-right', 'farmer.bend', 'farmer.pickup-rabbit', 'farmer.hold-rabbit'], attachmentSlots: ['baked-rabbit'],
    actions: [
      capability('notice', 'farmer.notice-right', 'right', 18, 'stationary'),
      capability('walk', 'farmer.walk-right', 'right', 30, 'locomotion'),
      capability('bend', 'farmer.bend', 'right', 18, 'stationary'),
      capability('pickup', 'farmer.pickup-rabbit', 'right', 18, 'stationary', ['rabbit']),
      capability('hold', 'farmer.hold-rabbit', 'right', 30, 'stationary', ['rabbit']),
    ],
  }],
  cameraCapabilities: [
    {intent: 'follow', minDurationFrames: 30, allowedShotTypes: ['wide']},
    {intent: 'slow-push-in', minDurationFrames: 30, allowedShotTypes: ['wide', 'medium']},
  ],
  environmentCapabilities: [{environmentId: 'pastoral-field', allowedEntityTypes: ['farmer', 'rabbit'], supportedDepthIntents: ['ground']}],
  fallbackRules: [],
};

type PackageAsset = {file: string; contentHash: string; width: number; height: number; qaStatus: string; provenance: AssetRecord['provenance']};
const packageJson = JSON.parse(await readFile(resolve(assetRoot, 'manifests', 'compiled-asset-package.json'), 'utf8')) as {assets: PackageAsset[]};
const packageAssets = new Map(packageJson.assets.map(asset => [asset.file, asset]));
const anchors = async (file: string): Promise<PoseAnchors> => (JSON.parse(await readFile(resolve(assetRoot, file), 'utf8')) as {anchors: PoseAnchors}).anchors;

function sourceVisual(id: string, kind: 'environment-layer' | 'effect', file: string, alphaMode: 'opaque' | 'straight' = 'straight'): AssetRecord {
  const source = packageAssets.get(file);
  if (source === undefined) throw new Error(`Compiled asset package missing ${file}`);
  return {id, kind, uri: `/asset-source/${file}`, contentHash: source.contentHash, source: 'generated', provenance: source.provenance, qaStatus: source.qaStatus === 'passed' ? 'passed' : 'warning', width: source.width, height: source.height, alphaMode};
}

async function adaptVisual(input: {
  id: string;
  kind: 'character-frame' | 'animal-frame' | 'prop' | 'effect';
  sourcePath: string;
  sourceHash: string;
  width: number;
  height: number;
  scale: number;
}): Promise<AssetRecord> {
  const filename = `${input.id}.png`;
  const output = resolve(visualRoot, filename);
  if (!contractOnly) await runFile(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', input.sourcePath, '-vf', `scale=iw*${input.scale}:ih*${input.scale}:flags=lanczos`, output]);
  const bytes = contractOnly ? await readFile(input.sourcePath) : await readFile(output);
  return {
    id: input.id, kind: input.kind, uri: `/artifacts/visual/${filename}`, contentHash: sha256(bytes), source: 'generated',
    provenance: {inputHash: input.sourceHash, producer: {name: 'm21-canonical-scale-adapter', version: '1.0.0'}, createdAt: '2026-08-13T00:00:00.000Z'},
    qaStatus: 'passed', width: Math.max(1, Math.round(input.width * input.scale)), height: Math.max(1, Math.round(input.height * input.scale)), alphaMode: 'straight',
  };
}

async function packageVisual(id: string, kind: 'character-frame' | 'animal-frame' | 'prop' | 'effect', file: string, scale: number): Promise<AssetRecord> {
  const source = packageAssets.get(file);
  if (source === undefined) throw new Error(`Compiled asset package missing ${file}`);
  return adaptVisual({id, kind, sourcePath: resolve(assetRoot, file), sourceHash: source.contentHash, width: source.width, height: source.height, scale});
}

async function localVisual(id: string, kind: 'character-frame' | 'animal-frame' | 'prop' | 'effect', file: string, width: number, height: number, scale: number): Promise<AssetRecord> {
  const sourcePath = resolve(root, file);
  const sourceBytes = await readFile(sourcePath);
  return adaptVisual({id, kind, sourcePath, sourceHash: sha256(sourceBytes), width, height, scale});
}

await mkdir(audioRoot, {recursive: true});
await mkdir(visualRoot, {recursive: true});
const effectiveDirectorPlan = await createEffectiveDirectorPlan({story, directorPlan, overrides: []});
const preflight = await compilePreflight({effectiveDirectorPlan, capabilityCatalog});
const ttsProvider = createTtsProvider(contractOnly ? 'fake' : (process.env.M21_TTS_PROVIDER ?? 'qwen3'));
const ttsArtifacts = await ttsProvider.synthesize(preflight.ttsRequests, {audioRoot, ffmpeg, root});

const adaptedVisuals = await Promise.all([
  packageVisual('farmer-idle', 'character-frame', 'normalized/farmer/idle.png', 0.205),
  packageVisual('farmer-notice', 'character-frame', 'normalized/farmer/notice-right.png', 0.205),
  ...[1, 2, 3, 4].map(number => packageVisual(`farmer-walk-${number}`, 'character-frame', `normalized/farmer/walk-0${number}.png`, 0.205)),
  packageVisual('farmer-bend', 'character-frame', 'normalized/farmer/bend.png', 0.205),
  ...[1, 2, 3, 4].map(number => localVisual(`farmer-pickup-rabbit-${number}`, 'character-frame', `assets/pickup-rabbit-0${number}.png`, 1024, 1536, 0.205)),
  packageVisual('farmer-hold-rabbit', 'character-frame', 'normalized/farmer/hold-rabbit.png', 0.205),
  ...[1, 2, 3, 4].map(number => packageVisual(`rabbit-run-${number}`, 'animal-frame', `normalized/rabbit/run-left-0${number}.png`, 0.10)),
  packageVisual('rabbit-collision', 'animal-frame', 'normalized/rabbit/collision.png', 0.10),
  packageVisual('rabbit-lying', 'animal-frame', 'normalized/rabbit/lying.png', 0.10),
  packageVisual('impact-burst', 'prop', 'processed/effects/impact.png', 0.25),
]);
const stumpSource = await readFile(resolve(root, 'assets', 'stump.png'));
adaptedVisuals.push(await adaptVisual({id: 'stump-prop', kind: 'prop', sourcePath: resolve(root, 'assets', 'stump.png'), sourceHash: sha256(stumpSource), width: 1672, height: 941, scale: 0.14}));

const clipFrame = async (assetId: string, anchorFile: string, durationFrames = 30) => ({assetId, durationFrames, anchors: await anchors(anchorFile), contact: {type: 'both' as const}, referenceFoot: 'midpoint' as const});
const pickupFeet = [
  {x: 0.4794921875, y: 0.7923177083333334},
  {x: 0.47705078125, y: 0.9029947916666666},
  {x: 0.5009765625, y: 0.93359375},
  {x: 0.50732421875, y: 0.9602864583333334},
];
const pickupFrame = (number: number) => {
  const foot = pickupFeet[number - 1]!;
  return {
    assetId: `farmer-pickup-rabbit-${number}`,
    durationFrames: 10,
    anchors: {
      foot,
      leftFoot: {x: foot.x - 0.05, y: foot.y},
      rightFoot: {x: foot.x + 0.05, y: foot.y},
      center: {x: 0.5, y: 0.52},
      head: {x: 0.5, y: number === 1 ? 0.31 : 0.22},
    },
    contact: {type: 'both' as const},
    referenceFoot: 'midpoint' as const,
  };
};
const poseClips = [{
  id: 'rabbit.run-left', entityType: 'rabbit', action: 'run', loop: true, direction: 'left' as const,
  frames: await Promise.all([1, 2, 3, 4].map(async number => ({assetId: `rabbit-run-${number}`, durationFrames: 3, anchors: await anchors(`anchors/rabbit/run-left-0${number}.json`), contact: {type: number % 2 === 1 ? 'left-foot' as const : 'right-foot' as const}, referenceFoot: number % 2 === 1 ? 'left-foot' as const : 'right-foot' as const}))),
  rootMotion: {mode: 'timeline' as const}, groundLock: {mode: 'contact-only' as const, maxCorrectionPx: 24},
}, {
  id: 'rabbit.collision', entityType: 'rabbit', action: 'collision', loop: true, direction: 'left' as const, frames: [await clipFrame('rabbit-collision', 'anchors/rabbit/collision.json')], rootMotion: {mode: 'timeline' as const}, groundLock: {mode: 'always' as const, maxCorrectionPx: 8},
}, {
  id: 'rabbit.lying', entityType: 'rabbit', action: 'lying', loop: true, direction: 'left' as const, frames: [await clipFrame('rabbit-lying', 'anchors/rabbit/lying.json')], rootMotion: {mode: 'timeline' as const}, groundLock: {mode: 'always' as const, maxCorrectionPx: 8},
}, {
  id: 'farmer.idle', entityType: 'farmer', action: 'idle', loop: true, direction: 'front' as const, frames: [await clipFrame('farmer-idle', 'anchors/farmer/idle.json')], rootMotion: {mode: 'timeline' as const}, groundLock: {mode: 'always' as const, maxCorrectionPx: 8},
}, {
  id: 'farmer.notice-right', entityType: 'farmer', action: 'notice', loop: true, direction: 'right' as const, frames: [await clipFrame('farmer-notice', 'anchors/farmer/notice-right.json')], rootMotion: {mode: 'timeline' as const}, groundLock: {mode: 'always' as const, maxCorrectionPx: 8},
}, {
  id: 'farmer.walk-right', entityType: 'farmer', action: 'walk', loop: true, direction: 'right' as const,
  frames: await Promise.all([1, 2, 3, 4].map(async number => ({assetId: `farmer-walk-${number}`, durationFrames: 5, anchors: await anchors(`anchors/farmer/walk-0${number}.json`), contact: {type: number % 2 === 1 ? 'left-foot' as const : 'right-foot' as const}, referenceFoot: number % 2 === 1 ? 'left-foot' as const : 'right-foot' as const}))),
  rootMotion: {mode: 'timeline' as const}, groundLock: {mode: 'contact-only' as const, maxCorrectionPx: 40},
}, {
  id: 'farmer.bend', entityType: 'farmer', action: 'bend', loop: true, direction: 'right' as const, frames: [await clipFrame('farmer-bend', 'anchors/farmer/bend.json')], rootMotion: {mode: 'timeline' as const}, groundLock: {mode: 'always' as const, maxCorrectionPx: 8},
}, {
  id: 'farmer.pickup-rabbit', entityType: 'farmer', action: 'pickup', loop: false, direction: 'right' as const,
  frames: [1, 2, 3, 4].map(pickupFrame), compositeSlots: [{id: 'rabbit', entityType: 'rabbit'}],
  rootMotion: {mode: 'timeline' as const}, groundLock: {mode: 'always' as const, maxCorrectionPx: 8},
}, {
  id: 'farmer.hold-rabbit', entityType: 'farmer', action: 'hold', loop: true, direction: 'right' as const,
  frames: [await clipFrame('farmer-hold-rabbit', 'anchors/farmer/hold-rabbit.json')], compositeSlots: [{id: 'rabbit', entityType: 'rabbit'}],
  rootMotion: {mode: 'timeline' as const}, groundLock: {mode: 'always' as const, maxCorrectionPx: 8},
}];

const catalogPayload: Omit<ResolvedAssetCatalog, 'catalogHash'> = {
  schemaVersion: '1.0.0', mode: 'experiment', productionReady: false,
  assets: {schemaVersion: '1.0.0', assets: [
    sourceVisual('environment-far', 'environment-layer', 'processed/environment/far.png', 'opaque'),
    sourceVisual('environment-mid', 'environment-layer', 'processed/environment/mid.png'),
    sourceVisual('environment-ground', 'environment-layer', 'processed/environment/ground.png'),
    sourceVisual('environment-foreground', 'environment-layer', 'processed/environment/foreground.png'),
    ...adaptedVisuals,
    ...ttsArtifacts.map(result => result.artifact.asset),
  ]},
  poseClips,
  environments: [{
    id: 'pastoral-field', name: 'Pastoral Field Overscan', referenceResolution: {width: 1280, height: 720},
    layers: [
      {id: 'far', assetId: 'environment-far', renderLayer: 'far', zIndex: 0, parallaxFactor: 0.1, transform: transformOverscan},
      {id: 'mid', assetId: 'environment-mid', renderLayer: 'mid', zIndex: 0, parallaxFactor: 0.35, transform: transformOverscan},
      {id: 'ground', assetId: 'environment-ground', renderLayer: 'ground', zIndex: 0, parallaxFactor: 0.7, transform: transformOverscan},
      {id: 'foreground', assetId: 'environment-foreground', renderLayer: 'foreground', zIndex: 0, parallaxFactor: 1.15, transform: transformOverscan},
    ],
    ground: {farLeft: {x: 0.05, y: 0.58}, farRight: {x: 0.95, y: 0.58}, nearLeft: {x: 0, y: 0.96}, nearRight: {x: 1, y: 0.96}, farScale: 0.55, nearScale: 1, depthEasing: 'linear', walkableZones: []}, occlusionZones: [],
  }],
  entityDefinitions: [
    {id: 'rabbit-definition', entityType: 'rabbit', displayName: 'Rabbit', poseClipIds: ['rabbit.run-left', 'rabbit.collision', 'rabbit.lying'], defaultPoseClipId: 'rabbit.run-left', attachmentSlots: [], tags: ['canonical-relative-scale-0.35']},
    {id: 'farmer-definition', entityType: 'farmer', displayName: 'Farmer', poseClipIds: ['farmer.idle', 'farmer.notice-right', 'farmer.walk-right', 'farmer.bend', 'farmer.pickup-rabbit', 'farmer.hold-rabbit'], defaultPoseClipId: 'farmer.idle', attachmentSlots: [{id: 'baked-rabbit', ownerAnchor: 'center'}], tags: ['canonical-scale-1.0']},
  ],
  characterBindings: [{characterId: 'rabbit', entityDefinitionId: 'rabbit-definition'}, {characterId: 'farmer', entityDefinitionId: 'farmer-definition'}],
};
const assetCatalog = {...catalogPayload, catalogHash: await hashResolvedAssetCatalogPayload(catalogPayload)};
const basePlan = await compileFinal({effectiveDirectorPlan, preflight, measuredAudio: ttsArtifacts.map(result => result.artifact.measuredAudio), capabilityCatalog, assetCatalog, context: {seed: 20260813, compilerVersion: '0.1.0', compiledAt: '2026-08-13T00:00:00.000Z'}});

function eventFrame(plan: RenderPlan, poseClipId: string): number {
  const event = plan.timeline.poseEvents.find(candidate => candidate.poseClipId === poseClipId);
  if (event === undefined) throw new Error(`Missing compiled PoseEvent for ${poseClipId}`);
  return event.frame;
}
function microMotion(durationFrames: number, amplitude: number) {
  const keyframes = [];
  for (let frame = 0; frame < durationFrames; frame += 15) keyframes.push({frame, value: keyframes.length % 2 === 0 ? -amplitude : amplitude, easing: 'linear' as const});
  if (keyframes.at(-1)?.frame !== durationFrames - 1) keyframes.push({frame: durationFrames - 1, value: 0, easing: 'hold' as const});
  return keyframes;
}
function applyVisualRecovery(plan: RenderPlan): RenderPlan {
  const recovered = structuredClone(plan);
  const duration = recovered.timeline.durationFrames;
  const collisionFrame = eventFrame(recovered, 'rabbit.collision');
  const lyingFrame = eventFrame(recovered, 'rabbit.lying');
  const walkFrame = eventFrame(recovered, 'farmer.walk-right');
  const bendFrame = eventFrame(recovered, 'farmer.bend');
  const pickupFrame = eventFrame(recovered, 'farmer.pickup-rabbit');
  const holdFrame = eventFrame(recovered, 'farmer.hold-rabbit');
  const holdSettleFrame = Math.min(duration - 2, holdFrame + 75);
  recovered.entities.push(
    {id: 'stump-definition', entityType: 'landmark', displayName: 'Collision Stump', poseClipIds: ['stump.idle'], defaultPoseClipId: 'stump.idle', attachmentSlots: [], tags: ['landmark']},
    {id: 'impact-definition', entityType: 'effect', displayName: 'Impact Burst', poseClipIds: ['impact.idle'], defaultPoseClipId: 'impact.idle', attachmentSlots: []},
  );
  recovered.instances.push(
    {id: 'stump', definitionId: 'stump-definition', sceneId: 'scene-field', activeRange: {startFrame: 0, endFrame: duration}, initialOwner: {kind: 'world', environmentId: 'pastoral-field'}},
    {id: 'impact', definitionId: 'impact-definition', sceneId: 'scene-field', activeRange: {startFrame: 0, endFrame: duration}, initialOwner: {kind: 'world', environmentId: 'pastoral-field'}},
  );
  recovered.poseClips.push(
    {id: 'stump.idle', entityType: 'landmark', action: 'idle', loop: true, direction: 'front', frames: [{assetId: 'stump-prop', durationFrames: 30, anchors: {foot: {x: 0.5, y: 0.93}, center: {x: 0.5, y: 0.55}}, contact: {type: 'none'}}], rootMotion: {mode: 'timeline'}, groundLock: {mode: 'none', maxCorrectionPx: 0}},
    {id: 'impact.idle', entityType: 'effect', action: 'impact', loop: true, direction: 'front', frames: [{assetId: 'impact-burst', durationFrames: 30, anchors: {foot: {x: 0.5, y: 0.5}, center: {x: 0.5, y: 0.5}}, contact: {type: 'none'}}], rootMotion: {mode: 'timeline'}, groundLock: {mode: 'none', maxCorrectionPx: 0}},
  );
  recovered.timeline.entityTracks.push(
    {entityId: 'stump', groundPosition: [{frame: 0, value: {u: 0.76, v: 0.66}, easing: 'hold'}]},
    {entityId: 'impact', groundPosition: [{frame: 0, value: {u: 0.715, v: 0.67}, easing: 'hold'}], scale: [{frame: 0, value: {x: 0.75, y: 0.75}, easing: 'linear'}, {frame: collisionFrame, value: {x: 0.75, y: 0.75}, easing: 'linear'}, {frame: collisionFrame + 9, value: {x: 1.15, y: 1.15}, easing: 'hold'}]},
  );
  const rabbitTrack = recovered.timeline.entityTracks.find(candidate => candidate.entityId === 'rabbit')!;
  rabbitTrack.groundPosition = [
    {frame: 0, value: {u: 0.90, v: 0.60}, easing: 'linear'},
    {frame: collisionFrame, value: {u: 0.70, v: 0.66}, easing: 'hold'},
    {frame: lyingFrame, value: {u: 0.69, v: 0.67}, easing: 'hold'},
    {frame: duration - 1, value: {u: 0.69, v: 0.67}, easing: 'hold'},
  ];
  const farmerTrack = recovered.timeline.entityTracks.find(candidate => candidate.entityId === 'farmer')!;
  farmerTrack.groundPosition = [
    {frame: 0, value: {u: 0.28, v: 0.65}, easing: 'hold'},
    {frame: walkFrame, value: {u: 0.28, v: 0.65}, easing: 'linear'},
    {frame: bendFrame, value: {u: 0.63, v: 0.67}, easing: 'hold'},
    {frame: duration - 1, value: {u: 0.63, v: 0.67}, easing: 'hold'},
  ];
  for (const [entityId, amplitude] of [['farmer', 0.004], ['rabbit', 0.003]] as const) {
    const track = recovered.timeline.entityTracks.find(candidate => candidate.entityId === entityId)!;
    track.rotation = microMotion(duration, amplitude);
  }
  recovered.timeline.visibilityEvents.push(
    {id: 'm21-impact-hidden-start', frame: 0, entityId: 'impact', visible: false},
    {id: 'm21-impact-show', frame: collisionFrame, entityId: 'impact', visible: true},
    {id: 'm21-impact-hide', frame: collisionFrame + 10, entityId: 'impact', visible: false},
  );
  recovered.timeline.ownershipEvents.push({
    id: 'm21-rabbit-baked-pickup',
    frame: pickupFrame,
    type: 'attach',
    entityId: 'rabbit',
    from: {kind: 'world', environmentId: 'pastoral-field'},
    to: {kind: 'entity', entityId: 'farmer', slot: 'baked-rabbit'},
    mode: 'baked',
    preserveWorldTransform: false,
    bakedBinding: {ownerEntityId: 'farmer', childEntityId: 'rabbit', compositeSlotId: 'rabbit'},
  });
  recovered.timeline.markers.push(
    {id: 'm21-marker-collision', frame: collisionFrame, type: 'collision', entityIds: ['rabbit', 'stump']},
    {id: 'm21-marker-pickup-contact', frame: pickupFrame, type: 'pickup', entityIds: ['farmer', 'rabbit']},
    {id: 'm21-marker-pickup-complete', frame: holdFrame, type: 'pickup-complete', entityIds: ['farmer', 'rabbit']},
    {id: 'm21-marker-hold-settle', frame: holdSettleFrame, type: 'camera-settle', entityIds: ['farmer']},
  );

  const environment = recovered.environments[0]!;
  const safeBounds = {minX: 440, maxX: 900, minY: 340, maxY: 380};
  const composition = new Map([
    ['shot-collision', {focusEntityId: 'rabbit', desiredScreenX: 820, leadRoom: 'left'}],
    ['shot-notice', {focusEntityId: 'farmer', desiredScreenX: 480, leadRoom: 'right'}],
    ['shot-approach', {focusEntityId: 'farmer', desiredScreenX: 500, leadRoom: 'right'}],
    ['shot-pickup', {focusEntityId: 'farmer', desiredScreenX: 560, leadRoom: 'center'}],
  ]);
  const shotZoomTargets = new Map([
    ['shot-collision', 1.14],
    ['shot-notice', 1.15],
    ['shot-approach', 1.14],
    ['shot-pickup', 1.14],
  ]);
  const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
  recovered.timeline.cameraTracks = recovered.timeline.shots.map(shot => {
    const contract = composition.get(shot.id)!;
    const focusTrack = recovered.timeline.entityTracks.find(track => track.entityId === contract.focusEntityId)!;
    const groundTrack = focusTrack.groundPosition!;
    const frames = [...new Set([shot.range.startFrame, ...groundTrack.filter(keyframe => keyframe.frame > shot.range.startFrame && keyframe.frame < shot.range.endFrame - 1).map(keyframe => keyframe.frame), shot.range.endFrame - 1])].sort((left, right) => left - right);
    return {
      shotId: shot.id,
      position: frames.map((frame, index) => {
        const world = projectGround(environment, evaluateGroundPointKeyframes(groundTrack, frame)).worldFootPosition;
        return {frame, value: {x: clamp(world.x + 640 - contract.desiredScreenX, safeBounds.minX, safeBounds.maxX), y: 360}, easing: index === frames.length - 1 ? 'hold' as const : 'ease-in-out' as const};
      }),
      zoom: shot.range.endFrame - shot.range.startFrame <= 1
        ? [{frame: shot.range.startFrame, value: 1.05, easing: 'hold' as const}]
        : shot.id === 'shot-pickup' && holdSettleFrame > shot.range.startFrame && holdSettleFrame < shot.range.endFrame - 1
          ? [
              {frame: shot.range.startFrame, value: 1.04, easing: 'ease-in-out' as const},
              {frame: holdSettleFrame, value: shotZoomTargets.get(shot.id)!, easing: 'ease-in-out' as const},
              {frame: shot.range.endFrame - 1, value: 1.12, easing: 'hold' as const},
            ]
          : [{frame: shot.range.startFrame, value: 1.04, easing: 'ease-in-out' as const}, {frame: shot.range.endFrame - 1, value: shotZoomTargets.get(shot.id)!, easing: 'hold' as const}],
    };
  });
  return RenderPlanSchema.parse(recovered);
}

const renderPlan = applyVisualRecovery(basePlan);
const narrationMaster = assembleNarrationWav({timeline: renderPlan.timeline, wavByAssetId: new Map(ttsArtifacts.map(result => [result.artifact.asset.id, result.wavBytes]))});
const renderPlanHash = await semanticRenderPlanHashV1(renderPlan);
await writeFile(resolve(artifacts, 'story.json'), `${JSON.stringify(story, null, 2)}\n`);
await writeFile(resolve(artifacts, 'director-plan.json'), `${JSON.stringify(directorPlan, null, 2)}\n`);
await writeFile(resolve(artifacts, 'preflight.json'), `${JSON.stringify(preflight, null, 2)}\n`);
await writeFile(resolve(artifacts, 'render-plan.json'), `${JSON.stringify(renderPlan, null, 2)}\n`);
await writeFile(resolve(artifacts, 'subtitles.srt'), timelineToSrt(renderPlan.timeline));
await writeFile(resolve(artifacts, 'subtitles.ass'), timelineToAss(renderPlan.timeline));
await writeFile(resolve(artifacts, 'narration-master.wav'), narrationMaster);
await writeFile(resolve(artifacts, 'generation-report.json'), `${JSON.stringify({
  sourceStoryHash, sourceDirectorPlanHash: effectiveDirectorPlan.sourceDirectorPlanHash, effectiveDirectorPlanHash: effectiveDirectorPlan.effectivePlanHash,
  preflightHash: preflight.preflightHash, assetCatalogHash: assetCatalog.catalogHash, renderPlanSemanticHash: renderPlanHash,
  media: {width: 1280, height: 720, fps: renderPlan.timeline.fps, frameCount: renderPlan.timeline.durationFrames, durationSeconds: renderPlan.timeline.durationFrames / renderPlan.timeline.fps},
  timelineAuthorship: 'final-compiler-plus-deterministic-visual-recovery-planner',
  tts: {kind: ttsProvider.kind, acceptanceEligible: ttsProvider.kind === 'qwen3' || ttsProvider.kind === 'sapi', ...ttsProvider.description},
  visualContracts: {environmentOverscan: 1.5, cameraSafeBounds: {minX: 440, maxX: 900, minY: 340, maxY: 380}, farmerCanonicalScale: 1, rabbitCanonicalRelativeScale: 0.35},
}, null, 2)}\n`);
process.stdout.write(`M2.1 generated artifacts: ${artifacts}\n`);
