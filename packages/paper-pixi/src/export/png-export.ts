import {CANONICAL_RENDER_SIZE} from '@pose-clip/paper-engine';
import type {PaperPixiApplication} from '../application/create-application.js';

export function exportCanonicalPngDataUrl(application: PaperPixiApplication): string {
  if (
    application.canvas.width !== CANONICAL_RENDER_SIZE.width
    || application.canvas.height !== CANONICAL_RENDER_SIZE.height
  ) {
    throw new Error(
      `Canonical framebuffer must be ${CANONICAL_RENDER_SIZE.width}x${CANONICAL_RENDER_SIZE.height}`,
    );
  }
  // Final export reads the same completed framebuffer shown by Preview. Calling
  // Pixi Extract here would re-render into a RenderTexture and can alter MSAA
  // edge pixels during crossfades.
  return application.canvas.toDataURL('image/png');
}
