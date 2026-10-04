import { MercatorCoordinate } from 'maplibre-gl';
import type { CustomLayerInterface, CustomRenderMethodInput, Map as GLMap } from 'maplibre-gl';
import { EntityProjection, entityVertex } from './entity-projection';
import type { Vec3 } from './model-glb';
import { ModelRegistry } from './models';
import type { RegisteredModel } from './models';
import { ModelRenderer } from './model-renderer';
import type { ModelDrawInstance, ModelGpu, PreparedModelFrame } from './model-renderer';
import { RidgelineError } from './errors';
import type { ModelAppearance } from './types';

export type ModelInstance = { id: string; modelId: string; asset: RegisteredModel<ModelGpu>; position: Vec3;
  heading: number; pitch: number; roll: number; grounded: boolean; appearance?: ModelAppearance };

/** Coordinates model readiness and the current frame independently of GPU resource ownership. */
export class ModelLayer implements CustomLayerInterface {
  readonly id = 'rl:models';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;
  private map?: GLMap;
  private renderer?: ModelRenderer;
  private prepared?: PreparedModelFrame;
  private instances: ModelInstance[] = [];
  private failed = false;
  constructor(private registry: ModelRegistry<ModelGpu>, private report: (error: RidgelineError) => void) {}
  set(instances: ModelInstance[]) { this.instances = instances; this.map?.triggerRepaint(); }
  onAdd(map: GLMap, gl: WebGL2RenderingContext) { this.map = map; this.renderer ??= new ModelRenderer(gl); this.failed = false; }
  onRemove() { this.registry.renderer(undefined); this.map = undefined; this.prepared = undefined; }
  destroy() { this.onRemove(); this.renderer?.destroy(); this.renderer = undefined; this.instances = []; }
  prerender(gl: WebGL2RenderingContext, input: CustomRenderMethodInput) {
    this.prepared = undefined;
    if (this.failed || !this.renderer || gl.isContextLost()) return;
    try {
      this.renderer.initialize(input);
      this.registry.renderer(this.renderer);
      const map = this.map;
      if (!map || !this.renderer) return;
      const canvas = map.getCanvas(), frame = new EntityProjection(input, map.getCenter().lng, canvas.clientWidth, canvas.clientHeight);
      const reference = MercatorCoordinate.fromLngLat(map.getCenter()), origin: [number, number] = [reference.x, reference.y];
      const draws = this.draws(origin);
      this.prepared = this.renderer.prepareFrame(input, frame, draws);
    } catch (cause) {
      this.fail(cause, 'Model frame preparation failed.');
    }
  }
  render() {
    if (this.failed) return;
    try { this.prepared?.draw(); }
    catch (cause) { this.fail(cause, 'Solid model drawing failed.'); }
  }
  private fail(cause: unknown, message: string) {
    this.failed = true; this.prepared = undefined;
    this.registry.renderer(undefined);
    const error = new RidgelineError('MODEL_RENDERER_FAILED', message, { operation: 'models', recoverable: true }, cause);
    this.registry.readinessFailed(error);
    this.report(error);
  }
  private draws(origin: [number, number]) {
    const groups = new Map<RegisteredModel<ModelGpu>, ModelDrawInstance[]>();
    for (const instance of this.instances) {
      if (this.registry.get(instance.modelId) !== instance.asset) continue;
      const { definition, model } = instance.asset;
      const scale = definition.metersPerUnit, heading = (instance.heading + definition.headingOffset) * Math.PI / 180;
      const pitch = instance.pitch * Math.PI / 180, roll = -instance.roll * Math.PI / 180;
      const rotate = (x: number, y: number, z: number): Vec3 => {
        // A proper glTF-to-ENU turn maps authored +X west, +Y up and +Z north.
        x = -x;
        const xr = x * Math.cos(roll) - y * Math.sin(roll), yr = x * Math.sin(roll) + y * Math.cos(roll);
        const yp = yr * Math.cos(pitch) + z * Math.sin(pitch), zp = -yr * Math.sin(pitch) + z * Math.cos(pitch);
        return [(xr * Math.cos(heading) + zp * Math.sin(heading)) * scale, (-xr * Math.sin(heading) + zp * Math.cos(heading)) * scale, yp * scale];
      };
      const position: Vec3 = [...instance.position];
      if (instance.grounded) position[2] += (model.bounds.max[1] - model.bounds.min[1]) * scale / 2;
      const values = groups.get(instance.asset) ?? [];
      values.push({ basis: [rotate(1, 0, 0), rotate(0, 1, 0), rotate(0, 0, 1)], anchor: entityVertex(position, origin),
        appearance: instance.appearance && { ...instance.appearance } });
      groups.set(instance.asset, values);
    }
    return [...groups].map(([asset, instances]) => ({ asset, origin, instances }));
  }
}
