import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeRgbaPng8, encodeRgbaPng} from '@pose-clip/asset-generation';
import {canonicalHash, sha256Bytes, type Point, type PoseAnchors} from '@pose-clip/schemas';

interface AnchorCalibrationFrame {
  readonly frameIndex: number;
  readonly frozenFrameExecutionKey: string;
  readonly sourceNormalizedContentHash: string;
  readonly candidateAnchoredContentHash: string;
  readonly candidateAnchors: PoseAnchors;
}

interface AnchorCalibrationReport {
  readonly status: string;
  readonly source: {
    readonly frozenPoseClipHash: string;
    readonly frozenProductionResultHash: string;
    readonly mattingCalibrationResultHash: string;
  };
  readonly specs: {readonly candidateAnchorSpecHash: string};
  readonly automatedChecksPassed: boolean;
  readonly visualApproval: string;
  readonly frames: readonly AnchorCalibrationFrame[];
  readonly calibrationResultHash: string;
}

interface Bounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const HEADER_HEIGHT = 56;
const ALPHA_THRESHOLD = 8;
const COLORS = {
  bounds: [255, 64, 64, 255],
  center: [0, 230, 255, 255],
  foot: [255, 220, 0, 255],
  leftFoot: [255, 64, 220, 255],
  rightFoot: [64, 128, 255, 255],
} as const;
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = process.env.M4_ANCHOR_CALIBRATION_REPORT_PATH
  ?? resolve(root, 'reports', 'anchor-calibration.json');
const anchorCasRoot = process.env.M4_ANCHOR_CANDIDATE_CAS_ROOT
  ?? resolve(root, 'generated', 'anchor-calibration', 'cas');
const outputRoot = process.env.M4_ANCHOR_OVERLAY_ROOT
  ?? resolve(root, 'review', 'anchor-overlays');
const outputReportPath = process.env.M4_ANCHOR_OVERLAY_REPORT_PATH
  ?? resolve(root, 'reports', 'anchor-overlay-review.json');

const reportBytes = new Uint8Array(await readFile(reportPath));
const report = JSON.parse(new TextDecoder().decode(reportBytes)) as AnchorCalibrationReport;
const {calibrationResultHash, ...calibrationPayload} = report;
if (
  report.status !== 'CANDIDATE_MEASURED'
  || !report.automatedChecksPassed
  || report.visualApproval !== 'pending'
  || await canonicalHash('pose-clip-anchor-calibration-result-v1', calibrationPayload) !== calibrationResultHash
) throw new Error('ANCHOR_OVERLAY_CALIBRATION_EVIDENCE_INVALID');

function setPixel(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: readonly [number, number, number, number],
): void {
  if (x < 0 || x >= width || y < 0 || y >= height) return;
  pixels.set(color, (y * width + x) * 4);
}

function fillRect(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
  color: readonly [number, number, number, number],
): void {
  for (let row = y; row < y + rectHeight; row += 1) {
    for (let column = x; column < x + rectWidth; column += 1) {
      setPixel(pixels, width, height, column, row, color);
    }
  }
}

function drawLine(
  pixels: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  color: readonly [number, number, number, number],
  thickness = 1,
): void {
  let x = startX;
  let y = startY;
  const deltaX = Math.abs(endX - startX);
  const stepX = startX < endX ? 1 : -1;
  const deltaY = -Math.abs(endY - startY);
  const stepY = startY < endY ? 1 : -1;
  let error = deltaX + deltaY;
  for (;;) {
    fillRect(
      pixels, width, height,
      x - Math.floor(thickness / 2), y - Math.floor(thickness / 2),
      thickness, thickness, color,
    );
    if (x === endX && y === endY) break;
    const doubled = 2 * error;
    if (doubled >= deltaY) {
      error += deltaY;
      x += stepX;
    }
    if (doubled <= deltaX) {
      error += deltaX;
      y += stepY;
    }
  }
}

function drawCircle(
  pixels: Uint8Array,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  radius: number,
  color: readonly [number, number, number, number],
): void {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      const distance = Math.hypot(x - centerX, y - centerY);
      if (distance >= radius - 2 && distance <= radius) setPixel(pixels, width, height, x, y, color);
    }
  }
  drawLine(pixels, width, height, centerX - radius, centerY, centerX + radius, centerY, color, 2);
  drawLine(pixels, width, height, centerX, centerY - radius, centerX, centerY + radius, color, 2);
}

function drawGlyph(
  pixels: Uint8Array,
  width: number,
  height: number,
  glyph: string,
  x: number,
  y: number,
  color: readonly [number, number, number, number],
): void {
  const rows = GLYPHS[glyph];
  if (rows === undefined) throw new Error(`ANCHOR_OVERLAY_GLYPH_UNSUPPORTED:${glyph}`);
  for (const [row, pattern] of rows.entries()) {
    for (const [column, bit] of [...pattern].entries()) {
      if (bit === '1') fillRect(pixels, width, height, x + column * 3, y + row * 3, 3, 3, color);
    }
  }
}

function foregroundBounds(pixels: Uint8Array, width: number, height: number): Bounds {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3]! < ALPHA_THRESHOLD) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('ANCHOR_OVERLAY_FOREGROUND_EMPTY');
  return {x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1};
}

function pointToPixels(point: Point, width: number, height: number): {x: number; y: number} {
  return {
    x: Math.max(0, Math.min(width - 1, Math.round(point.x * width - 0.5))),
    y: Math.max(0, Math.min(height - 1, Math.round(point.y * height - 0.5))) + HEADER_HEIGHT,
  };
}

function renderOverlay(
  sourcePixels: Uint8Array,
  width: number,
  height: number,
  bounds: Bounds,
  anchors: PoseAnchors,
): Uint8Array {
  const outputHeight = height + HEADER_HEIGHT;
  const output = new Uint8Array(width * outputHeight * 4);
  fillRect(output, width, outputHeight, 0, 0, width, HEADER_HEIGHT, [28, 30, 36, 255]);
  const legend = [
    {glyph: 'B', color: COLORS.bounds},
    {glyph: 'C', color: COLORS.center},
    {glyph: 'F', color: COLORS.foot},
    {glyph: 'L', color: COLORS.leftFoot},
    {glyph: 'R', color: COLORS.rightFoot},
  ] as const;
  for (const [index, entry] of legend.entries()) {
    const x = 12 + index * 96;
    fillRect(output, width, outputHeight, x, 16, 24, 24, entry.color);
    drawGlyph(output, width, outputHeight, entry.glyph, x + 34, 17, entry.color);
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = (y * width + x) * 4;
      const outputOffset = ((y + HEADER_HEIGHT) * width + x) * 4;
      const checker = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 === 0 ? 238 : 205;
      const alpha = sourcePixels[sourceOffset + 3]! / 255;
      output[outputOffset] = Math.round(sourcePixels[sourceOffset]! * alpha + checker * (1 - alpha));
      output[outputOffset + 1] = Math.round(sourcePixels[sourceOffset + 1]! * alpha + checker * (1 - alpha));
      output[outputOffset + 2] = Math.round(sourcePixels[sourceOffset + 2]! * alpha + checker * (1 - alpha));
      output[outputOffset + 3] = 255;
    }
  }
  const boundsTop = bounds.y + HEADER_HEIGHT;
  const boundsRight = bounds.x + bounds.width - 1;
  const boundsBottom = boundsTop + bounds.height - 1;
  drawLine(output, width, outputHeight, bounds.x, boundsTop, boundsRight, boundsTop, COLORS.bounds, 3);
  drawLine(output, width, outputHeight, boundsRight, boundsTop, boundsRight, boundsBottom, COLORS.bounds, 3);
  drawLine(output, width, outputHeight, boundsRight, boundsBottom, bounds.x, boundsBottom, COLORS.bounds, 3);
  drawLine(output, width, outputHeight, bounds.x, boundsBottom, bounds.x, boundsTop, COLORS.bounds, 3);
  const center = pointToPixels(anchors.center, width, height);
  drawLine(output, width, outputHeight, center.x - 10, center.y - 10, center.x + 10, center.y + 10, COLORS.center, 3);
  drawLine(output, width, outputHeight, center.x - 10, center.y + 10, center.x + 10, center.y - 10, COLORS.center, 3);
  const foot = pointToPixels(anchors.foot, width, height);
  drawLine(output, width, outputHeight, foot.x - 14, foot.y, foot.x + 14, foot.y, COLORS.foot, 4);
  drawLine(output, width, outputHeight, foot.x, foot.y - 10, foot.x, foot.y + 4, COLORS.foot, 3);
  if (anchors.leftFoot !== undefined) {
    const point = pointToPixels(anchors.leftFoot, width, height);
    drawCircle(output, width, outputHeight, point.x, point.y, 10, COLORS.leftFoot);
  }
  if (anchors.rightFoot !== undefined) {
    const point = pointToPixels(anchors.rightFoot, width, height);
    drawCircle(output, width, outputHeight, point.x, point.y, 7, COLORS.rightFoot);
  }
  return output;
}

await mkdir(outputRoot, {recursive: true});
const frames = [];
for (const frame of report.frames) {
  if (frame.sourceNormalizedContentHash !== frame.candidateAnchoredContentHash) {
    throw new Error(`ANCHOR_OVERLAY_PIXEL_IDENTITY_MISMATCH:${frame.frameIndex}`);
  }
  const sourceBytes = new Uint8Array(await readFile(resolve(
    anchorCasRoot,
    `${frame.candidateAnchoredContentHash}.png`,
  )));
  if (await sha256Bytes(sourceBytes) !== frame.candidateAnchoredContentHash) {
    throw new Error(`ANCHOR_OVERLAY_SOURCE_HASH_MISMATCH:${frame.frameIndex}`);
  }
  const decoded = decodeRgbaPng8(sourceBytes);
  const bounds = foregroundBounds(decoded.pixels, decoded.width, decoded.height);
  const overlayBytes = encodeRgbaPng({
    width: decoded.width,
    height: decoded.height + HEADER_HEIGHT,
    pixels: renderOverlay(decoded.pixels, decoded.width, decoded.height, bounds, frame.candidateAnchors),
  });
  const fileName = `frame-${frame.frameIndex}-anchor-overlay.png`;
  await writeFile(resolve(outputRoot, fileName), overlayBytes);
  frames.push({
    frameIndex: frame.frameIndex,
    frozenFrameExecutionKey: frame.frozenFrameExecutionKey,
    sourceContentHash: frame.candidateAnchoredContentHash,
    sourceBounds: bounds,
    anchors: frame.candidateAnchors,
    overlay: {
      fileName,
      contentHash: await sha256Bytes(overlayBytes),
      width: decoded.width,
      height: decoded.height + HEADER_HEIGHT,
    },
    visualReview: 'pending' as const,
  });
}
const payload = {
  schemaVersion: '1.0.0' as const,
  gate: 'M4 Commit 8.3 — Anchor Overlay Human Review',
  status: 'AWAITING_HUMAN_REVIEW' as const,
  source: {
    frozenPoseClipHash: report.source.frozenPoseClipHash,
    frozenProductionResultHash: report.source.frozenProductionResultHash,
    mattingCalibrationResultHash: report.source.mattingCalibrationResultHash,
    anchorCalibrationResultHash: calibrationResultHash,
    candidateAnchorSpecHash: report.specs.candidateAnchorSpecHash,
  },
  legend: {
    B: {meaning: 'subjectBounds', rgba: COLORS.bounds},
    C: {meaning: 'center', rgba: COLORS.center},
    F: {meaning: 'global foot', rgba: COLORS.foot},
    L: {meaning: 'screen-left foot', rgba: COLORS.leftFoot},
    R: {meaning: 'screen-right foot', rgba: COLORS.rightFoot},
  },
  alphaThreshold: ALPHA_THRESHOLD,
  frames,
  visualApproval: 'pending' as const,
};
const outputReport = {
  ...payload,
  overlayReviewResultHash: await canonicalHash('pose-clip-anchor-overlay-review-v1', payload),
};
await mkdir(dirname(outputReportPath), {recursive: true});
await writeFile(outputReportPath, `${JSON.stringify(outputReport, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(outputReport, null, 2));
