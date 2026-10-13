import { Color } from '@maplibre/maplibre-gl-style-spec';
import type { ExpressionSpecification } from 'maplibre-gl';
import { modelAppearance } from './model-settings';
import type { FeatureHighlight, FeatureStyle, LabelStyle, SymbolAnchor } from './types';

const anchors: readonly SymbolAnchor[] = ['center', 'left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
function number(value: number | undefined, name: string, minimum = 0, maximum = Infinity, strict = false) {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || (strict ? value <= minimum : value < minimum) || value > maximum))
    throw new Error(`${name} must be a finite ${strict ? 'positive' : 'valid nonnegative'} number.`);
}
function color(value: string | undefined, name: string) {
  if (value !== undefined && (typeof value !== 'string' || !Color.parse(value))) throw new Error(`${name} needs a supported CSS color.`);
}
function anchor(value: SymbolAnchor | undefined) {
  if (value !== undefined && !anchors.includes(value)) throw new Error('Unsupported symbol anchor.');
}
function highlight(value: FeatureHighlight | undefined) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Highlight appearance must be an object.');
  value = { ...value };
  for (const key of ['color', 'fillColor', 'labelColor'] as const) color(value[key], key);
  for (const key of ['radius', 'lineWidth'] as const) number(value[key], key);
  for (const key of ['fillOpacity', 'iconOpacity'] as const) number(value[key], key, 0, 1);
  number(value.modelBrightness, 'Model brightening', 0, 1);
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') throw new Error('Highlight enabled must be a boolean.');
  return { ...value };
}
function label(value: LabelStyle | undefined) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Label appearance must be an object.');
  value = { ...value };
  if (Array.isArray(value.font)) value.font = Array.from(value.font);
  if (Array.isArray(value.offset)) value.offset = [value.offset[0], value.offset[1]];
  number(value.size, 'Label size', 0, Infinity, true); number(value.haloWidth, 'Label halo width');
  color(value.color, 'Label color'); color(value.haloColor, 'Label halo color'); anchor(value.anchor);
  if (value.font !== undefined && (!Array.isArray(value.font) || !value.font.length || value.font.length > 16 || Array.from(value.font).some(font => typeof font !== 'string' || !font.trim())))
    throw new Error('Label fonts need 1 to 16 nonempty names.');
  if (value.offset !== undefined && (!Array.isArray(value.offset) || value.offset.length !== 2 || Array.from(value.offset).some(part => typeof part !== 'number' || !Number.isFinite(part))))
    throw new Error('Label offset needs two finite numbers.');
  return { ...value, ...(value.font ? { font: [...value.font] } : {}), ...(value.offset ? { offset: [value.offset[0], value.offset[1]] as [number, number] } : {}) };
}

/** Snapshot callback output before it can reach renderer-owned state. */
export function featureStyle(style: FeatureStyle): FeatureStyle {
  if (!style || typeof style !== 'object' || Array.isArray(style)) throw new Error('Feature style must be an object.');
  style = { ...style };
  if (Array.isArray(style.dashArray)) style.dashArray = Array.from(style.dashArray);
  for (const key of ['color', 'fillColor'] as const) color(style[key], key);
  for (const key of ['radius', 'lineWidth'] as const) number(style[key], key);
  number(style.fillOpacity, 'Fill opacity', 0, 1); number(style.iconSize, 'Icon size', 0, Infinity, true);
  if (style.iconRotation !== undefined && (typeof style.iconRotation !== 'number' || !Number.isFinite(style.iconRotation))) throw new Error('Icon rotation must be finite.');
  if (style.iconRotationAlignment !== undefined && style.iconRotationAlignment !== 'map' && style.iconRotationAlignment !== 'viewport') throw new Error('Unsupported icon rotation alignment.');
  anchor(style.iconAnchor);
  for (const key of ['icon', 'label'] as const) if (style[key] !== undefined && typeof style[key] !== 'string') throw new Error(`${key} must be a string.`);
  if (style.dashed !== undefined && typeof style.dashed !== 'boolean') throw new Error('Dashed must be a boolean.');
  if (style.dashArray !== undefined && (!Array.isArray(style.dashArray) || !style.dashArray.length || style.dashArray.length > 32 ||
    Array.from(style.dashArray).some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0) || !style.dashArray.some(value => value > 0)))
    throw new Error('Dash arrays need 1 to 32 nonnegative finite lengths, including a positive length.');
  return { ...style, modelAppearance: modelAppearance(style.modelAppearance), labelStyle: label(style.labelStyle),
    selected: highlight(style.selected), hover: highlight(style.hover), ...(style.dashArray ? { dashArray: [...style.dashArray] } : {}) };
}

export function styleProperties(style: FeatureStyle) {
  const labels = style.labelStyle;
  const properties: Record<string, string | number | boolean | readonly number[] | readonly string[]> = {
    _rl_color: style.color ?? '#216e5b', _rl_fill: style.fillColor ?? style.color ?? '#216e5b', _rl_radius: style.radius ?? 6,
    _rl_width: style.lineWidth ?? 3, _rl_opacity: style.fillOpacity ?? .2,
    _rl_dashed: Boolean(style.dashArray || style.dashed), _rl_dash: JSON.stringify(style.dashArray ?? [3, 2]),
    _rl_icon_size: style.iconSize ?? 1, _rl_icon_rotation: style.iconRotation ?? 0, _rl_icon_anchor: style.iconAnchor ?? 'center',
    _rl_icon_alignment: style.iconRotationAlignment ?? 'viewport',
    _rl_label_font: labels?.font ?? ['Noto Sans Regular'], _rl_label_font_key: JSON.stringify(labels?.font ?? ['Noto Sans Regular']),
    _rl_label_size: labels?.size ?? 12, _rl_label_anchor: labels?.anchor ?? 'top',
    _rl_label_color: labels?.color ?? '#203b32', _rl_label_halo_color: labels?.haloColor ?? '#ffffff', _rl_label_halo_width: labels?.haloWidth ?? 1.5,
  };
  for (const state of ['selected', 'hover'] as const) {
    const appearance = style[state];
    properties[`_rl_${state}_enabled`] = appearance?.enabled ?? true;
    if (appearance) for (const key of ['color', 'radius', 'lineWidth', 'fillColor', 'fillOpacity', 'labelColor', 'iconOpacity'] as const) {
      const value = appearance[key];
      if (value !== undefined) properties[`_rl_${state}_${key}`] = value;
    }
  }
  return properties;
}

/** Explicit selection overrides hover; unspecified fields retain the existing feedback. */
export function highlightExpression(key: keyof FeatureHighlight, fallback: ExpressionSpecification | number | string,
  selectedFallback: ExpressionSpecification | number | string = fallback, hoverFallback: ExpressionSpecification | number | string = fallback): ExpressionSpecification {
  const hover: ExpressionSpecification = ['case', ['boolean', ['feature-state', 'hover'], false], ['coalesce', ['get', `_rl_hover_${key}`], hoverFallback], fallback];
  const selectedBase: ExpressionSpecification = selectedFallback === fallback ? hover
    : ['case', ['boolean', ['feature-state', 'hover'], false], ['coalesce', ['get', `_rl_hover_${key}`], selectedFallback], selectedFallback];
  const enabledHover: ExpressionSpecification = ['case', ['==', ['get', '_rl_hover_enabled'], false], fallback, hover];
  const enabledSelected: ExpressionSpecification = ['case', ['==', ['get', '_rl_selected_enabled'], false], fallback,
    ['coalesce', ['get', `_rl_selected_${key}`], ['case', ['==', ['get', '_rl_hover_enabled'], false], selectedFallback, selectedBase]]];
  return ['case', ['boolean', ['feature-state', 'selected'], false], enabledSelected, enabledHover];
}

/** Resolve feedback independently of selection identity and label priority. */
export function resolveHighlight(style: FeatureStyle | undefined, selected: boolean, hovered: boolean) {
  if (selected && style?.selected?.enabled === false) selected = hovered = false;
  if (hovered && style?.hover?.enabled === false) hovered = false;
  const selection = selected ? style?.selected : undefined, hover = hovered ? style?.hover : undefined;
  return { selected, hovered, appearance: {
    color: selection?.color ?? hover?.color, radius: selection?.radius ?? hover?.radius,
    lineWidth: selection?.lineWidth ?? hover?.lineWidth, fillColor: selection?.fillColor ?? hover?.fillColor,
    fillOpacity: selection?.fillOpacity ?? hover?.fillOpacity, labelColor: selection?.labelColor ?? hover?.labelColor,
    iconOpacity: selection?.iconOpacity ?? hover?.iconOpacity, modelBrightness: selection?.modelBrightness ?? hover?.modelBrightness,
  } };
}

export function dashExpression(styles: Iterable<FeatureStyle>): ExpressionSpecification {
  return arrayExpression('_rl_dash', [...styles].flatMap(style => style.dashArray ? [style.dashArray] : []), [3, 2]);
}
export function fontExpression(styles: Iterable<FeatureStyle>): ExpressionSpecification {
  return arrayExpression('_rl_label_font_key', [...styles].flatMap(style => style.labelStyle?.font ? [style.labelStyle.font] : []), ['Noto Sans Regular']);
}
function arrayExpression(property: string, arrays: Iterable<readonly number[] | readonly string[]>, fallback: readonly number[] | readonly string[]): ExpressionSpecification {
  const patterns = new Map<string, readonly number[] | readonly string[]>();
  for (const array of arrays) patterns.set(JSON.stringify(array), array);
  const entries = [...patterns], first = entries.shift();
  if (!first) return ['literal', [...fallback]];
  // MapLibre collects dash/font assets from literal branches; property-derived arrays cannot declare them.
  const branches = entries.flatMap(([key, pattern]): (string | ExpressionSpecification)[] => [key, ['literal', [...pattern]]]);
  return ['match', ['get', property], first[0], ['literal', [...first[1]]], ...branches, ['literal', [...fallback]]];
}
