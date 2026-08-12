import {Application, Container, type ApplicationOptions} from 'pixi.js';
import {CANONICAL_RENDER_SIZE} from '@pose-clip/paper-engine';

export interface PaperPixiApplication {
  readonly app: Application;
  readonly root: Container;
  readonly canvas: HTMLCanvasElement;
  destroy(): void;
}

export async function createPaperPixiApplication(
  options: Partial<ApplicationOptions> = {},
): Promise<PaperPixiApplication> {
  const app = new Application();
  await app.init({
    autoDensity: false,
    autoStart: false,
    sharedTicker: false,
    preference: 'webgl',
    preferWebGLVersion: 2,
    preserveDrawingBuffer: true,
    antialias: true,
    background: 0x000000,
    backgroundAlpha: 0,
    ...options,
    // Canonical pixel space is not configurable in v0.1.
    width: CANONICAL_RENDER_SIZE.width,
    height: CANONICAL_RENDER_SIZE.height,
    resolution: 1,
  });
  app.stop();
  const root = new Container();
  root.label = 'paper-render-root';
  root.sortableChildren = false;
  app.stage.addChild(root);
  return {
    app,
    root,
    canvas: app.canvas,
    destroy() {
      app.destroy({removeView: true}, {children: true, texture: false, textureSource: false});
    },
  };
}
