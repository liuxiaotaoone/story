import {
  RenderPlanSchema,
  assertRenderPlanIntegrity,
  type CompileDiagnostic,
  type FinalCompileInput,
  type RenderPlan,
} from '@pose-clip/schemas';
import {prepareRenderPlan} from '@pose-clip/paper-engine';
import {assertFinalCompileInputIntegrity} from '../integrity/final-compile-integrity.js';
import {solveDurations} from '../timing/duration-solver.js';
import {CompileIntegrityError} from '../integrity/hash-integrity.js';
import {optionalActionDropDiagnostics} from './optional-action-policy.js';
import {buildCanonicalTimeline} from './timeline-builder.js';
import {compileSupplementalInstances} from './visual-planning-compiler.js';

function warningProjection(diagnostic: CompileDiagnostic) {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.path === undefined ? {} : {path: diagnostic.path}),
  };
}

export async function compileFinal(input: FinalCompileInput): Promise<RenderPlan> {
  const parsed = await assertFinalCompileInputIntegrity(input);
  if (parsed.effectiveDirectorPlan.plan.scenes.length !== 1) {
    throw new CompileIntegrityError('M2 Final Compiler v0.1 requires exactly one Director scene');
  }
  const duration = solveDurations({
    effectiveDirectorPlan: parsed.effectiveDirectorPlan,
    preflight: parsed.preflight,
    measuredAudio: parsed.measuredAudio,
    capabilityCatalog: parsed.capabilityCatalog,
    fps: 30,
  });
  if (!duration.ok) {
    throw new CompileIntegrityError(`Duration Solver failed: ${duration.diagnostics.map(item => item.message).join('; ')}`);
  }
  const diagnostics = [
    ...parsed.preflight.diagnostics,
    ...duration.timing.diagnostics,
    ...optionalActionDropDiagnostics(parsed.preflight.expandedActions),
  ];
  const sceneIds = new Set(parsed.effectiveDirectorPlan.plan.scenes.map(scene => scene.id));
  const timeline = buildCanonicalTimeline({
    effective: parsed.effectiveDirectorPlan,
    preflight: parsed.preflight,
    measuredAudio: parsed.measuredAudio,
    timing: duration.timing,
    catalog: parsed.assetCatalog,
  });
  const supplementalInstances = compileSupplementalInstances({
    effective: parsed.effectiveDirectorPlan,
    preflight: parsed.preflight,
    catalog: parsed.assetCatalog,
    durationFrames: timeline.durationFrames,
  });
  const renderPlan = RenderPlanSchema.parse({
    schemaVersion: '1.0.0',
    project: {
      id: parsed.effectiveDirectorPlan.plan.projectId,
      title: parsed.effectiveDirectorPlan.plan.storyBible.title,
      fps: 30,
      resolution: {width: 1280, height: 720},
      sampleRate: 48_000,
      seed: parsed.context.seed,
      styleGuideId: parsed.effectiveDirectorPlan.plan.storyBible.styleGuideId,
      capabilityCatalogVersion: parsed.capabilityCatalog.catalogVersion,
    },
    assets: parsed.assetCatalog.assets,
    environments: parsed.assetCatalog.environments.filter(environment =>
      parsed.effectiveDirectorPlan.plan.scenes.some(scene => scene.environmentIntent === environment.id)),
    entities: parsed.assetCatalog.entityDefinitions,
    instances: [...parsed.effectiveDirectorPlan.plan.characters.map(character => {
      const binding = parsed.assetCatalog.characterBindings.find(candidate => candidate.characterId === character.characterId)!;
      return {
        id: character.characterId,
        definitionId: binding.entityDefinitionId,
        sceneId: [...sceneIds][0]!,
        activeRange: {startFrame: 0, endFrame: timeline.durationFrames},
        initialOwner: {kind: 'world' as const, environmentId: parsed.effectiveDirectorPlan.plan.scenes[0]!.environmentIntent},
      };
    }), ...supplementalInstances],
    poseClips: parsed.assetCatalog.poseClips,
    timeline,
    provenance: {
      compilerVersion: parsed.context.compilerVersion,
      sourceDirectorPlanHash: parsed.effectiveDirectorPlan.sourceDirectorPlanHash,
      effectiveDirectorPlanHash: parsed.effectiveDirectorPlan.effectivePlanHash,
      directorOverrideIds: parsed.effectiveDirectorPlan.overrideIds,
      capabilityCatalogVersion: parsed.capabilityCatalog.catalogVersion,
      compiledAt: parsed.context.compiledAt,
      warnings: diagnostics.filter(diagnostic => diagnostic.severity !== 'error').map(warningProjection),
    },
  });
  const validated = assertRenderPlanIntegrity(renderPlan);
  prepareRenderPlan(validated);
  return validated;
}
