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
  publish(): void;
};
type FrameOptions = {
  prepare(projection: EntityProjection, rendererAvailable: boolean): ModelFrame | undefined;
  diagnostic(error: RidgelineError): void;
};

/** Preflights models before opacity changes and publishes state only after the main pass. */
export class ModelLayer implements CustomLayerInterface {
  readonly id = 'rl:models';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  private map?: GLMap;
  private renderer?: ModelRenderer;
  private prepared?: PreparedModelFrame;
  private frame?: ModelFrame;
  private projection?: EntityProjection;
  private failed = false;
  private error?: RidgelineError;
  private unavailable = false;
  private initialized = false;
  constructor(private registry: ModelRegistry<ModelGpu>, private options: FrameOptions) {}
  onAdd(map: GLMap, gl: WebGL2RenderingContext) {
    this.map = map; this.renderer ??= new ModelRenderer(gl); this.failed = false;
    map.on('render', this.completed);
  }
  onRemove() {
    this.map?.off('render', this.completed);
    this.registry.renderer(undefined); this.map = undefined;
    this.prepared = undefined; this.frame = undefined; this.projection = undefined;
  }
  destroy() { this.onRemove(); this.renderer?.destroy(); this.renderer = undefined; this.error = undefined; }
  retry() { this.failed = false; this.map?.triggerRepaint(); }
  prerender(gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    this.prepared = undefined; this.frame = undefined;
    const map = this.map;
    if (!map || !this.renderer || gl.isContextLost()) return;
    const canvas = map.getCanvas();
    this.projection = new EntityProjection(input, map.getCenter().lng, canvas.clientWidth, canvas.clientHeight);
    try {
      if (!this.failed) { this.renderer.initialize(input); this.initialized = true; this.registry.renderer(this.renderer); }
      if (this.map !== map || !this.renderer) return;
      let frame = this.options.prepare(this.projection, !this.failed);
      // A preparation callback can replace the current input before committing any visibility.
      if (!frame?.current()) frame = this.options.prepare(this.projection, !this.failed);
      if (!frame?.current()) return;
      if (!this.failed) this.prepared = this.renderer.prepareFrame(input, this.projection, frame.draws);
      if (!frame.current()) { this.prepared = undefined; return; }
      if (frame.commit() && frame.current()) this.frame = frame;
      else this.prepared = undefined;
    } catch (cause) { this.fallback(cause); }
  }
  render() {
    if (!this.frame?.current()) return;
    try { this.prepared?.draw(); }
    catch (cause) { this.fallback(cause); }
  }
  private fallback(cause: unknown) {
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
    const frame = this.frame, error = this.error;
    this.frame = undefined; this.error = undefined;
    if (frame?.current()) frame.publish();
    if (this.unavailable && this.map) {
      this.unavailable = false; this.registry.renderer(undefined);
      if (!this.initialized && error) this.registry.readinessFailed(error);
    }
    if (error && this.map) this.options.diagnostic(error);
  };
}
