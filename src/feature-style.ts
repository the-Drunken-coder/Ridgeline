import { Color } from '@maplibre/maplibre-gl-style-spec';
import type { ExpressionSpecification } from 'maplibre-gl';
import { modelAppearance } from './model-settings';
import type { FeatureHighlight, FeatureStyle, LabelStyle, SymbolAnchor } from './types';

export const nativeDefaults = {
  color: '#216e5b', radius: 6, lineWidth: 3, fillOpacity: .2,
  selectedFillOpacity: .45, selectedLineWidth: 5, hoverRadius: 12, hoverColor: '#db6a20',
  circleStrokeColor: '#ffffff', circleStrokeWidth: 2, selectedCircleStrokeWidth: 4,
  dashArray: [3, 2], iconSize: 1, iconRotation: 0, iconAnchor: 'center', iconRotationAlignment: 'viewport',
  labelFont: ['Noto Sans Regular'], labelSize: 12, labelAnchor: 'top', labelColor: '#203b32', labelHaloColor: '#ffffff', labelHaloWidth: 1.5,
};

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
function arraySnapshot(value: unknown, minimum: number, maximum: number, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  const length = value.length;
  if (!Number.isInteger(length) || length < minimum || length > maximum) throw new Error(`${name} has an invalid length.`);
  // Bound allocation before reading indexed getters; do not invoke custom iterators.
  return Array.from({ length }, (_, index): unknown => value[index]);
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
  if (value.font !== undefined) {
    const font = arraySnapshot(value.font, 1, 16, 'Label fonts');
    if (!font.every((item): item is string => typeof item === 'string' && Boolean(item.trim()))) throw new Error('Label fonts need nonempty names.');
    value.font = font;
  }
  if (value.offset !== undefined) {
    const [x, y] = arraySnapshot(value.offset, 2, 2, 'Label offset');
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Label offset needs two finite numbers.');
    value.offset = [x, y];
  }
  number(value.size, 'Label size', 0, Infinity, true); number(value.haloWidth, 'Label halo width');
  color(value.color, 'Label color'); color(value.haloColor, 'Label halo color'); anchor(value.anchor);
  return value;
}

/** Snapshot callback output before it can reach renderer-owned state. */
export function featureStyle(style: FeatureStyle): FeatureStyle {
  if (!style || typeof style !== 'object' || Array.isArray(style)) throw new Error('Feature style must be an object.');
  style = { ...style };
  if (style.dashArray !== undefined) {
    const dash = arraySnapshot(style.dashArray, 1, 32, 'Dash array');
    if (!dash.every((item): item is number => typeof item === 'number' && Number.isFinite(item) && item >= 0) || !dash.some(item => item > 0))
      throw new Error('Dash arrays need nonnegative finite lengths, including a positive length.');
    style.dashArray = dash;
  }
  for (const key of ['color', 'fillColor'] as const) color(style[key], key);
  for (const key of ['radius', 'lineWidth'] as const) number(style[key], key);
  number(style.fillOpacity, 'Fill opacity', 0, 1); number(style.iconSize, 'Icon size', 0, Infinity, true);
  if (style.iconRotation !== undefined && (typeof style.iconRotation !== 'number' || !Number.isFinite(style.iconRotation))) throw new Error('Icon rotation must be finite.');
  if (style.iconRotationAlignment !== undefined && style.iconRotationAlignment !== 'map' && style.iconRotationAlignment !== 'viewport') throw new Error('Unsupported icon rotation alignment.');
  anchor(style.iconAnchor);
  for (const key of ['icon', 'label'] as const) if (style[key] !== undefined && typeof style[key] !== 'string') throw new Error(`${key} must be a string.`);
  if (style.dashed !== undefined && typeof style.dashed !== 'boolean') throw new Error('Dashed must be a boolean.');
  return { ...style, modelAppearance: modelAppearance(style.modelAppearance), labelStyle: label(style.labelStyle),
    selected: highlight(style.selected), hover: highlight(style.hover), ...(style.dashArray ? { dashArray: [...style.dashArray] } : {}) };
}

export function styleProperties(style: FeatureStyle) {
  const labels = style.labelStyle;
  const properties: Record<string, string | number | boolean | readonly number[] | readonly string[]> = {
    _rl_color: style.color ?? nativeDefaults.color, _rl_fill: style.fillColor ?? style.color ?? nativeDefaults.color, _rl_radius: style.radius ?? nativeDefaults.radius,
    _rl_width: style.lineWidth ?? nativeDefaults.lineWidth, _rl_opacity: style.fillOpacity ?? nativeDefaults.fillOpacity,
    _rl_dashed: Boolean(style.dashArray || style.dashed), _rl_dash: JSON.stringify(style.dashArray ?? nativeDefaults.dashArray),
    _rl_icon_size: style.iconSize ?? nativeDefaults.iconSize, _rl_icon_rotation: style.iconRotation ?? nativeDefaults.iconRotation, _rl_icon_anchor: style.iconAnchor ?? nativeDefaults.iconAnchor,
    _rl_icon_alignment: style.iconRotationAlignment ?? nativeDefaults.iconRotationAlignment,
    _rl_label_font: labels?.font ?? [...nativeDefaults.labelFont], _rl_label_font_key: JSON.stringify(labels?.font ?? nativeDefaults.labelFont),
    _rl_label_size: labels?.size ?? nativeDefaults.labelSize, _rl_label_anchor: labels?.anchor ?? nativeDefaults.labelAnchor,
    _rl_label_color: labels?.color ?? nativeDefaults.labelColor, _rl_label_halo_color: labels?.haloColor ?? nativeDefaults.labelHaloColor, _rl_label_halo_width: labels?.haloWidth ?? nativeDefaults.labelHaloWidth,
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

export const nativeExpressions = {
  fillColor: highlightExpression('fillColor', ['get', '_rl_fill']),
  fillOpacity: highlightExpression('fillOpacity', ['get', '_rl_opacity'], nativeDefaults.selectedFillOpacity),
  lineColor: highlightExpression('color', ['get', '_rl_color'], undefined, nativeDefaults.hoverColor),
  lineWidth: highlightExpression('lineWidth', ['get', '_rl_width'], ['max', nativeDefaults.selectedLineWidth, ['get', '_rl_width']]),
  circleRadius: highlightExpression('radius', ['get', '_rl_radius'], undefined, ['max', nativeDefaults.hoverRadius, ['get', '_rl_radius']]),
  circleColor: highlightExpression('color', ['get', '_rl_color']),
  circleStrokeWidth: ['case', ['all', ['boolean', ['feature-state', 'selected'], false], ['!=', ['get', '_rl_selected_enabled'], false]],
    nativeDefaults.selectedCircleStrokeWidth, nativeDefaults.circleStrokeWidth],
  circleStrokeColor: ['case', ['all', ['boolean', ['feature-state', 'selected'], false], ['==', ['get', '_rl_selected_enabled'], false]], nativeDefaults.circleStrokeColor,
    ['all', ['boolean', ['feature-state', 'hover'], false], ['!=', ['get', '_rl_hover_enabled'], false]], nativeDefaults.hoverColor, nativeDefaults.circleStrokeColor],
  iconOpacity: highlightExpression('iconOpacity', 1),
  labelColor: highlightExpression('labelColor', ['get', '_rl_label_color']),
} satisfies Record<string, ExpressionSpecification>;

/** Native feedback keeps each representation's defaults and explicit field overrides. */
export function resolveNativeAppearance(style: FeatureStyle | undefined, selected: boolean, hovered: boolean) {
  const feedback = resolveHighlight(style, selected, hovered), appearance = feedback.appearance;
  const color = style?.color ?? nativeDefaults.color, width = style?.lineWidth ?? nativeDefaults.lineWidth, radius = style?.radius ?? nativeDefaults.radius;
  return {
    fillColor: appearance.fillColor ?? style?.fillColor ?? color,
    fillOpacity: appearance.fillOpacity ?? (feedback.selected ? nativeDefaults.selectedFillOpacity : style?.fillOpacity ?? nativeDefaults.fillOpacity),
    lineColor: appearance.color ?? (feedback.hovered ? nativeDefaults.hoverColor : color),
    lineWidth: appearance.lineWidth ?? (feedback.selected ? Math.max(nativeDefaults.selectedLineWidth, width) : width),
    circleRadius: appearance.radius ?? (feedback.hovered ? Math.max(nativeDefaults.hoverRadius, radius) : radius),
    circleColor: appearance.color ?? color,
    circleStrokeWidth: feedback.selected ? nativeDefaults.selectedCircleStrokeWidth : nativeDefaults.circleStrokeWidth,
    circleStrokeColor: feedback.hovered ? nativeDefaults.hoverColor : nativeDefaults.circleStrokeColor,
    iconOpacity: appearance.iconOpacity ?? 1,
    labelColor: appearance.labelColor ?? style?.labelStyle?.color ?? nativeDefaults.labelColor,
  };
}

export function nativeVisibility(style: FeatureStyle | undefined, selected: boolean, hovered: boolean) {
  const appearance = resolveNativeAppearance(style, selected, hovered);
  return { icon: appearance.iconOpacity !== 0, fill: appearance.fillOpacity !== 0 && Color.parse(appearance.fillColor)?.a !== 0 };
}

export function dashExpression(styles: Iterable<FeatureStyle>): ExpressionSpecification {
  return arrayExpression('_rl_dash', [...styles].flatMap(style => style.dashArray ? [style.dashArray] : []), nativeDefaults.dashArray);
}
export function fontExpression(styles: Iterable<FeatureStyle>): ExpressionSpecification {
  return arrayExpression('_rl_label_font_key', [...styles].flatMap(style => style.labelStyle?.font ? [style.labelStyle.font] : []), nativeDefaults.labelFont);
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
