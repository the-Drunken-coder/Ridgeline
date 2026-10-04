import type { CustomLayerInterface, CustomRenderMethodInput, Map as GLMap } from 'maplibre-gl';
import { EntityProjection } from './entity-projection';
import { ModelRegistry } from './models';
import { ModelRenderer } from './model-renderer';
import type { ModelDraw, ModelGpu, PreparedModelFrame } from './model-renderer';
import { RidgelineError } from './errors';

export type ModelFrame = {
  draws: ModelDraw[];
  current(): boolean;
  commit(): boolean;
  publish(modelsDrawn: boolean): void;
};
type FrameOptions = {
  prepare(projection: EntityProjection, rendererAvailable: boolean): ModelFrame | undefined;
  diagnostic(error: RidgelineError): void;
  contextLost?(): void;
  contextRestored?(): void;
};

/** Preflights models before opacity changes and publishes state only after the main pass. */
export class ModelLayer implements CustomLayerInterface {
  readonly id = 'rl:models';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  private map?: GLMap;
  private renderer?: ModelRenderer;
  private gl?: WebGL2RenderingContext;
  private prepared?: PreparedModelFrame;
  private frame?: ModelFrame;
  private projection?: EntityProjection;
  private failed = false;
  private error?: RidgelineError;
  private unavailable = false;
  private initialized = false;
  private lost = false;
  private destroyed = false;
  private drawn = false;
  constructor(private registry: ModelRegistry<ModelGpu>, private options: FrameOptions) {}
  onAdd(map: GLMap, gl: WebGL2RenderingContext) {
    if (this.destroyed) return;
    this.map = map; this.gl = gl; this.renderer ??= new ModelRenderer(gl); this.failed = false;
    map.on('render', this.completed);
    if (this.lost) { this.lost = false; this.options.contextRestored?.(); }
  }
  onRemove() {
    this.map?.off('render', this.completed);
    // MapLibre removes custom layers before firing its map context-loss event.
    if (this.gl?.isContextLost()) this.contextLost();
    else this.registry.renderer(undefined);
    this.map = undefined;
    this.prepared = undefined; this.frame = undefined; this.projection = undefined;
  }
  contextLost() {
    if (this.destroyed || this.lost) return;
    this.lost = true; this.drawn = false;
    this.prepared = undefined; this.frame = undefined; this.projection = undefined;
    this.error = undefined; this.unavailable = false; this.initialized = false;
    this.options.contextLost?.();
    this.registry.contextLost();
    this.renderer?.destroy(); this.renderer = undefined;
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true; this.onRemove(); this.renderer?.destroy();
    this.renderer = undefined; this.gl = undefined; this.error = undefined;
  }
  retry() { this.failed = false; this.registry.retry(); if (!this.lost && !this.destroyed) this.map?.triggerRepaint(); }
  prerender(gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    this.prepared = undefined; this.frame = undefined; this.drawn = false;
    const map = this.map;
    if (gl.isContextLost()) { this.contextLost(); return; }
    if (!map || !this.renderer || this.destroyed) return;
    const canvas = map.getCanvas();
    this.projection = new EntityProjection(input, map.getCenter().lng, canvas.clientWidth, canvas.clientHeight);
    try {
      if (!this.failed) { this.renderer.initialize(input); this.initialized = true; this.registry.renderer(this.renderer); }
      if (this.map !== map || !this.renderer) return;
      for (let attempt = 0; attempt < 2 && this.map === map && this.renderer; attempt++) {
        const frame = this.options.prepare(this.projection, !this.failed);
        // Preparation or source callbacks may replace input before any model is submitted.
        if (!frame?.current()) continue;
        if (!this.failed) this.prepared = this.renderer.prepareFrame(input, this.projection, frame.draws);
        if (frame.current() && frame.commit() && frame.current()) { this.frame = frame; return; }
        this.prepared = undefined;
      }
    } catch (cause) { this.fallback(cause); }
  }
  render(gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    // Another custom layer can change consumer state after our offscreen pass.
    // Preflight again before drawing so the later icon layers use this same revision.
    if (!this.frame?.current()) this.prerender(gl, input);
    if (!this.frame?.current()) return;
    if (this.gl?.isContextLost()) { this.contextLost(); return; }
    try { this.prepared?.draw(); this.drawn = Boolean(this.prepared); }
    catch (cause) { this.fallback(cause); }
  }
  private fallback(cause: unknown) {
    if (this.gl?.isContextLost()) { this.contextLost(); return; }
    this.failed = true; this.prepared = undefined; this.frame = undefined;
    this.unavailable = true;
    this.error = new RidgelineError('MODEL_RENDERER_FAILED', 'Model frame could not render; eligible icons remain available.',
      { operation: 'models', recoverable: true }, cause);
    if (!this.map || !this.projection) return;
    try {
      const frame = this.options.prepare(this.projection, false);
      if (frame?.current() && frame.commit() && frame.current()) this.frame = frame;
    } catch { /* Preserve the first failure. A lost destination cannot accept a fallback frame. */ }
  }
  private completed = () => {
    const frame = this.frame, error = this.error, drawn = this.drawn;
    this.frame = undefined; this.error = undefined; this.drawn = false;
    if (frame?.current()) frame.publish(drawn);
    if (this.unavailable && this.map) {
      this.unavailable = false; this.registry.renderer(undefined);
      if (!this.initialized && error) this.registry.readinessFailed(error);
    }
    if (error && this.map) this.options.diagnostic(error);
  };
}
