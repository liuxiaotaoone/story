import {readFile} from 'node:fs/promises';
import {describe, expect, it} from 'vitest';
import {decodeRgbaPng8} from '@pose-clip/asset-generation';
import {
  RenderPlanSchema,
  canonicalHash,
  hashPoseClipContent,
  semanticRenderPlanHash,
  sha256Bytes,
} from '@pose-clip/schemas';

interface CalibrationReport {
  readonly calibrationResultHash: string;
}

interface OverlayReviewReport {
  readonly status: string;
  readonly source: {
    readonly mattingCalibrationResultHash: string;
    readonly anchorCalibrationResultHash: string;
  };
  readonly frames: ReadonlyArray<{
    readonly frameIndex: number;
    readonly overlay: {
      readonly fileName: string;
      readonly contentHash: string;
      readonly width: number;
      readonly height: number;
    };
    readonly visualReview: string;
  }>;
  readonly visualApproval: string;
  readonly overlayReviewResultHash: string;
}

const decode = <T,>(bytes: Uint8Array): T => JSON.parse(new TextDecoder().decode(bytes)) as T;

describe('M4 Commit 8.3 external calibration evidence package', () => {
  it('ships hash-bound Matting, Anchor and four Overlay review artifacts', async () => {
    const [mattingBytes, anchorBytes, overlayBytes] = await Promise.all([
      readFile(new URL('../reports/matting-calibration.json', import.meta.url)),
      readFile(new URL('../reports/anchor-calibration.json', import.meta.url)),
      readFile(new URL('../reports/anchor-overlay-review.json', import.meta.url)),
    ]);
    const matting = decode<CalibrationReport>(mattingBytes);
    const anchor = decode<CalibrationReport>(anchorBytes);
    const overlay = decode<OverlayReviewReport>(overlayBytes);
    const {calibrationResultHash: mattingResultHash, ...mattingPayload} = matting;
    const {calibrationResultHash: anchorResultHash, ...anchorPayload} = anchor;
    const {overlayReviewResultHash, ...overlayPayload} = overlay;

    expect(await canonicalHash('pose-clip-matting-calibration-result-v1', mattingPayload))
      .toBe(mattingResultHash);
    expect(await canonicalHash('pose-clip-anchor-calibration-result-v1', anchorPayload))
      .toBe(anchorResultHash);
    expect(await canonicalHash('pose-clip-anchor-overlay-review-v1', overlayPayload))
      .toBe(overlayReviewResultHash);
    expect(overlay.source).toMatchObject({
      mattingCalibrationResultHash: mattingResultHash,
      anchorCalibrationResultHash: anchorResultHash,
    });
    expect(overlay.status).toBe('AWAITING_HUMAN_REVIEW');
    expect(overlay.visualApproval).toBe('pending');
    expect(overlay.frames).toHaveLength(4);
    expect(overlay.overlayReviewResultHash)
      .toBe('e28a88de99165f5b017d8817bd416c9547a81d2b57a5e201b265833376e89e22');

    for (const [frameIndex, frame] of overlay.frames.entries()) {
      expect(frame.frameIndex).toBe(frameIndex);
      expect(frame.visualReview).toBe('pending');
      const bytes = new Uint8Array(await readFile(new URL(
        `../review/anchor-overlays/${frame.overlay.fileName}`,
        import.meta.url,
      )));
      expect(await sha256Bytes(bytes)).toBe(frame.overlay.contentHash);
      const decoded = decodeRgbaPng8(bytes);
      expect({width: decoded.width, height: decoded.height}).toEqual({
        width: frame.overlay.width,
        height: frame.overlay.height,
      });
    }
  });

  it('binds Human Approval, Candidate Identity, Paper Engine admission and the first MP4', async () => {
    const [approvalBytes, productionBytes, integrationBytes, renderPlanBytes, videoReportBytes, videoBytes] = await Promise.all([
      readFile(new URL('../review/candidate-visual-approval.json', import.meta.url)),
      readFile(new URL('../review/candidate-production-result.json', import.meta.url)),
      readFile(new URL('../reports/candidate-paper-engine-integration.json', import.meta.url)),
      readFile(new URL('../../renderer-feasibility/candidate/render-plan.json', import.meta.url)),
      readFile(new URL('../reports/first-real-mp4.json', import.meta.url)),
      readFile(new URL('../review/first-real-mp4/rabbit-real-candidate-4s.mp4', import.meta.url)),
    ]);
    const approval = decode<any>(approvalBytes);
    const production = decode<any>(productionBytes);
    const integration = decode<any>(integrationBytes);
    const renderPlan = RenderPlanSchema.parse(decode<unknown>(renderPlanBytes));
    const videoReport = decode<any>(videoReportBytes);
    const {approvalHash, ...approvalPayload} = approval;

    expect(await canonicalHash('pose-clip-candidate-visual-approval-v1', approvalPayload)).toBe(approvalHash);
    expect(approval.promotion).toMatchObject({
      candidateProfileAuthorized: true,
      productionApprovalGranted: false,
      continuityThresholdsCalibrated: false,
    });
    expect(integration.status).toBe('PASS');
    expect(integration.candidateProfileHash).toBe(production.productionProfile.profileHash);
    expect(integration.sourceProductionResultHash).toBe(production.resultHash);
    expect(integration.poseClipHash).toBe(await hashPoseClipContent(production.poseClip));
    expect(integration.renderPlanHash).toBe(await semanticRenderPlanHash(renderPlan));
    expect(videoReport.status).toBe('PASS');
    expect(videoReport.source.renderPlanHash).toBe(integration.renderPlanHash);
    expect(videoReport.render).toMatchObject({width: 1280, height: 720, fps: 30, frames: 120});
    expect(await sha256Bytes(videoBytes)).toBe(videoReport.video.contentHash);
  });

  it('isolates playback tempo across three hash-bound MP4 variants', async () => {
    const report = decode<any>(await readFile(new URL('../reports/pose-tempo-comparison.json', import.meta.url)));
    expect(report.status).toBe('PASS');
    expect(report.controls).toEqual({
      samePngBytes: true,
      sameMattingNormalizeAnchor: true,
      sameGroundLockAndCamera: true,
      crossfade: false,
      transitionFrames: false,
      changedVariable: 'PoseClip frame duration only',
    });
    expect(report.variants.map((variant: any) => variant.label)).toEqual(['0.8s', '1.0s', '1.2s']);

    for (const variant of report.variants) {
      const [planBytes, videoBytes] = await Promise.all([
        readFile(new URL(`../../renderer-feasibility/candidate/render-plan-tempo-${variant.label}.json`, import.meta.url)),
        readFile(new URL(`../review/tempo-comparison/${variant.video.fileName}`, import.meta.url)),
      ]);
      const plan = RenderPlanSchema.parse(decode<unknown>(planBytes));
      expect(await semanticRenderPlanHash(plan)).toBe(variant.renderPlanHash);
      expect(plan.poseClips[0]?.frames.map(frame => frame.durationFrames)).toEqual(variant.poseDurations);
      expect(plan.timeline.durationFrames).toBe(variant.cycleFrames * 3);
      expect(variant.frameCount).toBe(variant.cycleFrames * 3);
      expect(await sha256Bytes(videoBytes)).toBe(variant.video.contentHash);
      expect(plan.assets.assets.map(asset => asset.contentHash))
        .toEqual(report.source.sharedFrameAssets.map((asset: any) => asset.contentHash));
    }
  });

  it('binds the selected 1.0s tempo to a 100ms foot-aligned Transition MP4', async () => {
    const [preferenceBytes, planReportBytes, planBytes, videoReportBytes, videoBytes] = await Promise.all([
      readFile(new URL('../review/tempo-human-preference.json', import.meta.url)),
      readFile(new URL('../reports/pose-transition-plan.json', import.meta.url)),
      readFile(new URL('../../renderer-feasibility/candidate/render-plan-transition-1.0s-100ms.json', import.meta.url)),
      readFile(new URL('../reports/pose-transition-video.json', import.meta.url)),
      readFile(new URL('../review/pose-transition/rabbit-real-tempo-1.0s-transition-100ms.mp4', import.meta.url)),
    ]);
    const preference = decode<any>(preferenceBytes);
    const planReport = decode<any>(planReportBytes);
    const plan = RenderPlanSchema.parse(decode<unknown>(planBytes));
    const videoReport = decode<any>(videoReportBytes);
    const {approvalHash, ...preferencePayload} = preference;
    const {transitionPlanResultHash, ...planReportPayload} = planReport;

    expect(await canonicalHash('pose-clip-tempo-human-preference-v1', preferencePayload)).toBe(approvalHash);
    expect(preference.selection).toMatchObject({label: '1.0s', cycleFrames: 30, cycleSeconds: 1});
    expect(preference.promotion).toMatchObject({
      candidatePlaybackDefaultAuthorized: true,
      productionPoseClipRewritten: false,
      transitionBaselineAuthorized: true,
      furtherTempoMicroTuningRequired: false,
    });
    expect(await canonicalHash('pose-clip-transition-plan-v1', planReportPayload)).toBe(transitionPlanResultHash);
    expect(await semanticRenderPlanHash(plan)).toBe(planReport.renderPlanHash);
    expect(plan.timeline.poseTransitions).toHaveLength(12);
    expect(plan.timeline.poseTransitions.every(transition => transition.mode === 'crossfade'
      && transition.durationFrames === 3
      && transition.anchorPolicy === 'foot')).toBe(true);
    expect(plan.assets.assets.map(asset => asset.contentHash))
      .toEqual(planReport.source.frameContentHashes.map((frame: any) => frame.contentHash));
    expect(videoReport.status).toBe('PASS');
    expect(videoReport.source.transitionPlanResultHash).toBe(transitionPlanResultHash);
    expect(videoReport.controls).toMatchObject({
      cycleFrames: 30,
      transitionFrames: 3,
      transitionMilliseconds: 100,
      anchorPolicy: 'foot',
      newGeneratedFrames: false,
      sourceAssetBytesChanged: false,
    });
    expect(await sha256Bytes(videoBytes)).toBe(videoReport.video.contentHash);
  });

  it('closes Transition tuning with a Human-authorized 2-frame/67ms MP4', async () => {
    const [reviewBytes, planReportBytes, planBytes, videoReportBytes, videoBytes] = await Promise.all([
      readFile(new URL('../review/transition-100ms-human-review.json', import.meta.url)),
      readFile(new URL('../reports/pose-transition-67ms-plan.json', import.meta.url)),
      readFile(new URL('../../renderer-feasibility/candidate/render-plan-transition-1.0s-67ms.json', import.meta.url)),
      readFile(new URL('../reports/pose-transition-67ms-video.json', import.meta.url)),
      readFile(new URL('../review/pose-transition/rabbit-real-tempo-1.0s-transition-67ms.mp4', import.meta.url)),
    ]);
    const review = decode<any>(reviewBytes);
    const planReport = decode<any>(planReportBytes);
    const plan = RenderPlanSchema.parse(decode<unknown>(planBytes));
    const videoReport = decode<any>(videoReportBytes);
    const {approvalHash, ...reviewPayload} = review;
    const {transitionPlanResultHash, ...planReportPayload} = planReport;

    expect(await canonicalHash('pose-clip-transition-human-review-v1', reviewPayload)).toBe(approvalHash);
    expect(review.decision).toBe('not-approved-as-default');
    expect(review.observations).toMatchObject({
      hardCutMaxAdjacentFrameDelta: 13.05,
      transition100msMaxAdjacentFrameDelta: 8.52,
      peakDeltaReductionApproxPercent: 35,
      temporalContinuityImproved: true,
      groundLockVisuallyStable: true,
      doubleImageGhosting: 'unacceptable-as-default',
    });
    expect(review.promotion).toMatchObject({
      transition100msDefaultAuthorized: false,
      transition2FrameExperimentAuthorized: true,
      closeTransitionTuningAfter2FrameExperiment: true,
      generationConsistencyBecomesPrimary: true,
    });
    expect(await canonicalHash('pose-clip-transition-plan-v1', planReportPayload)).toBe(transitionPlanResultHash);
    expect(await semanticRenderPlanHash(plan)).toBe(planReport.renderPlanHash);
    expect(plan.timeline.poseTransitions).toHaveLength(12);
    expect(plan.timeline.poseTransitions.every(transition => transition.mode === 'crossfade'
      && transition.durationFrames === 2
      && transition.anchorPolicy === 'foot')).toBe(true);
    expect(plan.assets.assets.map(asset => asset.contentHash))
      .toEqual(planReport.source.frameContentHashes.map((frame: any) => frame.contentHash));
    expect(planReport.closure).toEqual({
      furtherTransitionDurationTuningPlanned: false,
      nextPrimaryWorkstream: 'comfyui-generation-consistency',
    });
    expect(videoReport.status).toBe('PASS');
    expect(videoReport.source.transition100msHumanReviewApprovalHash).toBe(approvalHash);
    expect(videoReport.controls).toMatchObject({
      cycleFrames: 30,
      transitionFrames: 2,
      transitionMilliseconds: 2000 / 30,
      anchorPolicy: 'foot',
      newGeneratedFrames: false,
      sourceAssetBytesChanged: false,
    });
    expect(await sha256Bytes(videoBytes)).toBe(videoReport.video.contentHash);
  });

  it('freezes the Human-approved Candidate Animation Profile without promoting Production', async () => {
    const [approvalBytes, profileBytes] = await Promise.all([
      readFile(new URL('../review/transition-67ms-human-approval.json', import.meta.url)),
      readFile(new URL('../frozen/rabbit-candidate-animation-profile.json', import.meta.url)),
    ]);
    const approval = decode<any>(approvalBytes);
    const profile = decode<any>(profileBytes);
    const {approvalHash, ...approvalPayload} = approval;
    const {profileHash, ...profilePayload} = profile;

    expect(await canonicalHash('pose-clip-transition-candidate-approval-v1', approvalPayload)).toBe(approvalHash);
    expect(approval.decision).toBe('approved-as-candidate-default');
    expect(approval.selection).toMatchObject({
      fps: 30,
      cycleFrames: 30,
      cycleSeconds: 1,
      transitionMode: 'crossfade',
      transitionFrames: 2,
      transitionDurationFormula: 'transitionFrames / fps',
      anchorPolicy: 'foot',
      role: 'candidate-default',
    });
    expect(approval.promotion).toEqual({
      paperEngineCandidateTransitionApproved: true,
      freezeTransitionParameters: true,
      furtherTransitionTuningAuthorized: false,
      productionProfileApproved: false,
      generationConsistencyBecomesPrimary: true,
    });
    expect(await canonicalHash('pose-clip-animation-candidate-profile-v1', profilePayload)).toBe(profileHash);
    expect(profile.status).toBe('frozen-candidate');
    expect(profile.source.transitionCandidateApprovalHash).toBe(approvalHash);
    expect(profile.playback).toMatchObject({
      cycleFrames: 30,
      cycleDurationSeconds: 1,
      holdFramesByPose: [5, 6, 5, 6],
      transitionMode: 'crossfade',
      transitionFrames: 2,
      transitionDurationFormula: 'transitionFrames / fps',
      anchorPolicy: 'foot',
      primaryVisibleBlendFramesPerTransition: 1,
    });
    expect(profile.notFrozen).toContain('production-profile-approval');
    expect(profile.closure).toEqual({
      tempoTuningClosed: true,
      transitionTuningClosed: true,
      mattingAnchorGroundLockReopened: false,
      nextPrimaryWorkstream: 'comfyui-generation-consistency',
    });
  });
});
