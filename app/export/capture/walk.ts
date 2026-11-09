/*
 * DOM walk of a rendered story → layer tree (`types.ts`). Runs in the catalog page: all styles come from
 * `getComputedStyle`, coordinates from `getBoundingClientRect`. Colors stay literals of a single mode (both
 * fields of the reference are equal); the builder merges the modes and binds them to tokens.
 */

import {
  brighten,
  firstFamily,
  isCollapsedTransform,
  isTransparent,
  parseBackdropBlur,
  parseBoxShadow,
  parseBrightness,
  parseColor,
  parseLinearGradient,
  parsePx,
  parseRadius,
  sameColor,
} from './css'
import { absorbEdgeMargins, absorbOffsets, flexLayout, gapsVary, isFlex, uniformGap, unstretched } from './layout'
import { hashString, maskToSvg, serializeSvg, svgFromMask } from './svg'
import { SVG_TINT } from './types'
import type {
  IBox,
  IFrameNode,
  IStroke,
  IRgba,
  ISvgNode,
  ITextNode,
  TColorRef,
  TEffect,
  TLayerNode,
  TLayout,
  TPaint,
  TSizing,
} from './types'

export interface ICaptureResult {
  tree: TLayerNode
  signature: string[]
  assets: Record<string, string>
  /**
   * The root width was set by the page, not the component: the root is as wide as the parent's content or the
   * window (AppBar with `position: fixed`). Dedupe compares such variants without horizontal geometry
   * (`dedupe.mjs`).
   */
  stretched: boolean
}

interface IWalkContext {
  win: Window
  assets: Record<string, string>
  /** Accumulated `filter: brightness()` of the ancestors: Figma has no such filter, the color is recomputed. */
  brightness: number
  /** Accumulated `transform: scale()` of the ancestors: the boxes already include it, the font size does not. */
  scale: number
  /**
   * Accumulated rotation and reflection of the ancestors (`rotate(180deg)` on a sort arrow, an expanded
   * accordion): the linear part of the matrix without scale. The boxes already include it, the vectors inside
   * the SVG do not.
   */
  rotation: TLinear
}

/** Linear part of a CSS matrix `[a, b, c, d]`: `matrix(a, b, c, d, tx, ty)` without translation. */
type TLinear = [number, number, number, number]

const IDENTITY: TLinear = [1, 0, 0, 1]

/**
 * Generated CSS-in-JS and CSS Modules classes (`css-1x2y3z`, `sc-abc`, `jsx-123`, `Button_root__a1B2c`): they
 * depend on the build, not the component, and are not part of the signature. The other classes are the
 * semantics of any library: MUI BEM classes, Bootstrap `btn btn-primary`, Tailwind utilities.
 */
const GENERATED_CLASS = /^(css|sc|jsx|svelte|astro|emotion|tw)-[A-Za-z0-9]|__[A-Za-z0-9_-]{5,}$/

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function literal(color: IRgba): TColorRef {
  return { light: color, dark: color }
}

function relativeBox(rect: DOMRect, parent: DOMRect): IBox {
  return { x: round(rect.x - parent.x), y: round(rect.y - parent.y), w: round(rect.width), h: round(rect.height) }
}

/** Element classes without the generated ones: the variant signature for finding instances. */
export function signatureOf(element: Element): string[] {
  return [...element.classList].filter((name) => !GENERATED_CLASS.test(name)).sort()
}

/**
 * Layer name from classes of the `Block-element` form: the element (`label`, `icon`), for `*-root` the block
 * without the library prefix (`MuiButton-root` → `Button`); otherwise the first non-generated class, otherwise
 * the tag.
 */
export function layerName(element: Element, fallback: string): string {
  let component: string | null = null
  let first: string | null = null
  for (const name of element.classList) {
    if (GENERATED_CLASS.test(name)) continue
    first ??= name
    const match = /^([A-Za-z][A-Za-z0-9]*)-([A-Za-z][A-Za-z0-9]*)$/.exec(name)
    if (!match) continue
    if (match[2] !== 'root') return match[2]
    component ??= match[1].replace(/^[A-Z][a-z0-9]*(?=[A-Z])/, '')
  }
  return component ?? first ?? fallback
}

/** Element hidden by clipping to zero: the "visually hidden" technique (screen reader labels, hidden inputs). */
function isClippedAway(style: CSSStyleDeclaration): boolean {
  return /^rect\(0px,? 0px,? 0px,? 0px\)$/.test(style.clip) || /^inset\((50|100)%\)$/.test(style.clipPath)
}

function isHidden(style: CSSStyleDeclaration, rect: DOMRect, element: Element): boolean {
  if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return true
  if (isClippedAway(style) || isCollapsedTransform(style.transform)) return true
  if (rect.width > 0 && rect.height > 0) return false
  // A zero-size box with visible overflow still draws its children (the row rendering area of a virtualized
  // table): such an element is walked, and an empty one is dropped after the walk.
  return style.overflow !== 'visible' || element.children.length === 0
}

function colorOf(ctx: IWalkContext, value: string): IRgba | null {
  const color = parseColor(value)
  if (!color || isTransparent(color)) return null
  return ctx.brightness === 1 ? color : brighten(color, ctx.brightness)
}

function fillsOf(ctx: IWalkContext, style: CSSStyleDeclaration, warnings: string[]): TPaint[] {
  const fills: TPaint[] = []
  const background = colorOf(ctx, style.backgroundColor)
  if (background) fills.push({ kind: 'solid', color: approx(ctx, literal(background)) })
  if (style.backgroundImage && style.backgroundImage !== 'none') {
    const gradient = parseLinearGradient(style.backgroundImage)
    if (gradient) {
      fills.push({
        kind: 'linear',
        angle: gradient.angle,
        stops: gradient.stops.map((stop) => ({ pos: stop.pos, color: literal(stop.color) })),
      })
    } else warnings.push(`фон ${style.backgroundImage.slice(0, 40)}… не перенесён`)
  }
  return fills
}

/** A color recomputed by the brightness filter is not bound to a token. */
function approx(ctx: IWalkContext, ref: TColorRef): TColorRef {
  return ctx.brightness === 1 || 'token' in ref ? ref : { ...ref, approx: true }
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const

function strokeOf(ctx: IWalkContext, style: CSSStyleDeclaration): IFrameNode['stroke'] {
  // A border gradient (`border-image-source`, the field underline) is drawn over the side colors: its sides are
  // visible even if `border-*-color` is transparent.
  const gradient = parseLinearGradient(style.borderImageSource)
  const widths = SIDES.map((side) => {
    if (style.getPropertyValue(`border-${side}-style`) === 'none') return 0
    const width = parsePx(style.getPropertyValue(`border-${side}-width`))
    // A transparent side is not drawn (ButtonGroup suppresses the right border of adjacent buttons): Figma has
    // one stroke paint for all sides, so such a side gets zero weight.
    if (width > 0 && !gradient && !colorOf(ctx, style.getPropertyValue(`border-${side}-color`))) return 0
    return width
  }) as [number, number, number, number]
  if (widths.every((width) => width === 0)) return undefined
  const sideIndex = widths.findIndex((width) => width > 0)
  const side = SIDES[sideIndex]
  const colorValue = style.getPropertyValue(`border-${side}-color`)
  const middle = gradient ? gradient.stops[Math.floor(gradient.stops.length / 2)]?.color : null
  const color =
    colorOf(ctx, colorValue) ??
    (middle && !isTransparent(middle) ? (ctx.brightness === 1 ? middle : brighten(middle, ctx.brightness)) : null)
  if (!color) return undefined
  const dashed = style.getPropertyValue(`border-${side}-style`) === 'dashed'
  const paint: IStroke['paint'] = gradient
    ? {
        kind: 'linear',
        angle: gradient.angle,
        stops: gradient.stops.map((stop) => ({
          pos: stop.pos,
          color: literal(ctx.brightness === 1 ? stop.color : brighten(stop.color, ctx.brightness)),
        })),
      }
    : undefined
  return { color: approx(ctx, literal(color)), weights: widths, dash: dashed ? [4, 4] : undefined, paint }
}

function radiusOf(style: CSSStyleDeclaration, box: IBox): IFrameNode['radius'] {
  return {
    values: [
      parseRadius(style.borderTopLeftRadius, box.w, box.h),
      parseRadius(style.borderTopRightRadius, box.w, box.h),
      parseRadius(style.borderBottomRightRadius, box.w, box.h),
      parseRadius(style.borderBottomLeftRadius, box.w, box.h),
    ],
  }
}

function effectsOf(style: CSSStyleDeclaration): TEffect[] {
  const effects = parseBoxShadow(style.boxShadow)
  const blur = parseBackdropBlur(style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter'))
  if (blur !== null) effects.push({ type: 'backgroundBlur', radius: blur })
  return effects
}

function textStyleOf(style: CSSStyleDeclaration, scale = 1): ITextNode['style'] {
  const sizePx = round(parsePx(style.fontSize) * scale)
  const lineHeight = round(
    (style.lineHeight === 'normal' ? parsePx(style.fontSize) * 1.2 : parsePx(style.lineHeight)) * scale,
  )
  const align =
    style.textAlign === 'center'
      ? 'center'
      : style.textAlign === 'right' || style.textAlign === 'end'
        ? 'right'
        : 'left'
  return {
    family: firstFamily(style.fontFamily),
    weight: Number(style.fontWeight) || 400,
    sizePx,
    lineHeightPx: lineHeight,
    letterSpacingPx: style.letterSpacing === 'normal' ? 0 : round(parsePx(style.letterSpacing) * scale),
    textCase:
      style.textTransform === 'uppercase'
        ? 'upper'
        : style.textTransform === 'lowercase'
          ? 'lower'
          : style.textTransform === 'capitalize'
            ? 'title'
            : 'original',
    decoration: style.textDecorationLine.includes('underline')
      ? 'underline'
      : style.textDecorationLine.includes('line-through')
        ? 'strike'
        : 'none',
    align,
  }
}

function textNode(
  ctx: IWalkContext,
  style: CSSStyleDeclaration,
  text: string,
  box: IBox,
  path: string,
  fixedWidth: boolean,
  inline = false,
): ITextNode {
  const color = colorOf(ctx, style.color) ?? { r: 0, g: 0, b: 0, a: 1 }
  const nowrap = style.whiteSpace === 'nowrap' || style.whiteSpace === 'pre'
  const textStyle = textStyleOf(style, ctx.scale)
  // Font metrics in Figma can be wider than in the browser: single-line text with the browser width wraps
  // there, so the width is fixed only for multiline text and for fields with a set width.
  const multiline = box.h > textStyle.lineHeightPx * 1.5
  // An inline element (`span`, `a`) takes the height of the font content, not the line: otherwise the layer in
  // Figma is taller than the browser box by the leading difference and drifts down.
  if (inline && !multiline && box.h > 0 && box.h < textStyle.lineHeightPx) textStyle.lineHeightPx = round(box.h)
  const node: ITextNode = {
    type: 'text',
    path,
    name: 'Label',
    box,
    text,
    style: textStyle,
    color: approx(ctx, literal(color)),
    autoResize: fixedWidth || (!nowrap && multiline) ? 'height' : 'both',
    // Ellipsis truncation only makes sense for fixed-width text.
    truncate: fixedWidth && isEllipsis(style) ? true : undefined,
  }
  if (textStyle.decoration !== 'none') {
    // The MUI link line is semi-transparent and thinner than Figma draws by default (text color, font thickness).
    const line = colorOf(ctx, style.textDecorationColor)
    if (line && !sameColor(line, color)) node.decorationColor = approx(ctx, literal(line))
    const thickness = parsePx(style.textDecorationThickness)
    if (thickness > 0) node.decorationThickness = thickness
    const offset = parsePx(style.textUnderlineOffset)
    if (offset !== 0) node.decorationOffset = offset
  }
  return node
}

/** Single-line ellipsis truncation (`text-overflow: ellipsis` with `overflow: hidden`). */
function isEllipsis(style: CSSStyleDeclaration): boolean {
  return style.textOverflow === 'ellipsis' && (style.overflow === 'hidden' || style.overflow === 'clip')
}

function svgNode(
  ctx: IWalkContext,
  element: SVGElement,
  style: CSSStyleDeclaration,
  box: IBox,
  path: string,
): ISvgNode {
  const color = colorOf(ctx, style.color) ?? { r: 0, g: 0, b: 0, a: 1 }
  // The color in the markup is neutral: identical glyphs are deduplicated, and the plugin paints them by the
  // node's `color`. Text is removed from the markup (text layers carry it), the CSS rotation is written into
  // the markup itself.
  const markup = serializeSvg(element, SVG_TINT, box.w, box.h, {
    rotation: isIdentity(ctx.rotation) ? null : ctx.rotation,
    skipText: true,
  })
  const key = hashString(markup)
  ctx.assets[key] = markup
  return { type: 'svg', path, name: 'Icon', box, asset: key, color: approx(ctx, literal(color)) }
}

/**
 * Text inside `svg` (the digit in a step circle) becomes text layers by the browser box: SVG import in Figma
 * places `text` without `dominant-baseline`, and the digit drifts off center.
 */
function svgTexts(ctx: IWalkContext, svg: SVGElement, path: string): ITextNode[] {
  const origin = svg.getBoundingClientRect()
  const viewBox = svg instanceof SVGSVGElement ? svg.viewBox.baseVal : null
  const units = viewBox && viewBox.width > 0 ? origin.width / viewBox.width : 1
  const nodes: ITextNode[] = []
  for (const element of svg.querySelectorAll('text')) {
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!text) continue
    const style = ctx.win.getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) continue
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    const color = colorOf(ctx, style.fill) ?? colorOf(ctx, style.color) ?? { r: 0, g: 0, b: 0, a: 1 }
    nodes.push({
      type: 'text',
      path: `${path}/text${nodes.length}`,
      name: 'Label',
      box: relativeBox(rect, origin),
      text,
      // The line height is the height of the text box in the browser (font ascent and descent): the baseline
      // in Figma lands where the browser put it.
      style: { ...textStyleOf(style, ctx.scale * units), lineHeightPx: round(rect.height), align: 'center' },
      color: approx(ctx, literal(color)),
      autoResize: 'both',
    })
  }
  return nodes
}

/**
 * `svg` as a layer. The element's own decoration (backing, border, shadow, padding, as in the tab icon tile)
 * and the text inside will not be carried by the markup in Figma: such an `svg` is a frame with the
 * decoration, a vector in the content area and text layers on top. Without them, a single vector.
 */
function svgLayer(ctx: IWalkContext, element: SVGElement, style: CSSStyleDeclaration, box: IBox, path: string) {
  const warnings: string[] = []
  const fills = fillsOf(ctx, style, warnings)
  const stroke = strokeOf(ctx, style)
  const effects = effectsOf(style)
  const inset = [
    parsePx(style.paddingTop) + parsePx(style.borderTopWidth),
    parsePx(style.paddingRight) + parsePx(style.borderRightWidth),
    parsePx(style.paddingBottom) + parsePx(style.borderBottomWidth),
    parsePx(style.paddingLeft) + parsePx(style.borderLeftWidth),
  ]
  const texts = svgTexts(ctx, element, path)
  const opacity = parseFloat(style.opacity)
  const boxed =
    fills.length > 0 ||
    stroke !== undefined ||
    effects.length > 0 ||
    inset.some((value) => value > 0) ||
    texts.length > 0
  if (!boxed) {
    const vector = svgNode(ctx, element, style, box, path)
    if (opacity < 1) vector.opacity = opacity
    return vector
  }
  const content: IBox = {
    x: inset[3],
    y: inset[0],
    w: Math.max(0.01, round(box.w - inset[1] - inset[3])),
    h: Math.max(0.01, round(box.h - inset[0] - inset[2])),
  }
  const frame: IFrameNode = {
    type: 'frame',
    path,
    name: layerName(element, 'Icon'),
    box,
    layout: { mode: 'none' },
    sizing: { w: 'fixed', h: 'fixed' },
    fills,
    stroke,
    radius: radiusOf(style, box),
    effects,
    clip: false,
    children: [svgNode(ctx, element, style, content, `${path}/0`), ...texts],
  }
  if (!frame.stroke) delete frame.stroke
  if (opacity < 1) frame.opacity = opacity
  if (warnings.length) frame.warnings = warnings
  const classes = signatureOf(element)
  if (classes.length > 0) frame.classes = classes
  return frame
}

/** Scale from the computed `transform` (`matrix(a, b, c, d, tx, ty)`): the length of the first column. */
function transformScale(transform: string): number {
  const match = /matrix\(([^)]+)\)/.exec(transform)
  if (!match) return 1
  const [a, b] = match[1].split(',').map((part) => parseFloat(part))
  const scale = Math.hypot(a, b)
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

/** Rotation or reflection from the computed `transform`: the normalized linear part; `null` if there is none. */
function rotationOf(transform: string): TLinear | null {
  const match = /matrix\(([^)]+)\)/.exec(transform)
  if (!match) return null
  const [a, b, c, d] = match[1].split(',').map((part) => parseFloat(part))
  const sx = Math.hypot(a, b)
  const sy = Math.hypot(c, d)
  if (!sx || !sy || ![a, b, c, d].every(Number.isFinite)) return null
  const linear: TLinear = [a / sx, b / sx, c / sy, d / sy]
  return isIdentity(linear) ? null : linear
}

function isIdentity(linear: TLinear): boolean {
  return linear.every((value, index) => Math.abs(value - IDENTITY[index]) < 1e-3)
}

/** Composition of linear parts: `inner` first, then `outer`. */
function multiply(outer: TLinear, inner: TLinear): TLinear {
  const [a1, b1, c1, d1] = outer
  const [a2, b2, c2, d2] = inner
  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2]
}

/**
 * Border of a `fieldset` with a `legend`: the browser draws the top side through the middle of the legend, not
 * along the box edge (the MUI field outline sits at `top: -5px` above the field). The layer box starts where
 * the border is visible.
 */
function fieldsetRect(element: Element, style: CSSStyleDeclaration, rect: DOMRect): DOMRect {
  if (element.tagName !== 'FIELDSET') return rect
  const legend = [...element.children].find((child) => child.tagName === 'LEGEND')
  if (!legend) return rect
  const legendRect = legend.getBoundingClientRect()
  const shift = legendRect.top + (legendRect.height - parsePx(style.borderTopWidth)) / 2 - rect.top
  if (shift <= 0.25 || shift >= rect.height) return rect
  return new DOMRect(rect.x, rect.y + shift, rect.width, rect.height - shift)
}

/** Translation from the computed `transform` (`matrix(a, b, c, d, tx, ty)`); rotations are not carried over. */
function translation(transform: string): { x: number; y: number } {
  const match = /matrix\(([^)]+)\)/.exec(transform)
  if (!match) return { x: 0, y: 0 }
  const parts = match[1].split(',').map((part) => parseFloat(part))
  return { x: round(parts[4] ?? 0), y: round(parts[5] ?? 0) }
}

/** A pseudo-element with content is a layer: the checkbox square, the chip dot, the check mark via `mask-image`. */
function pseudoNode(
  ctx: IWalkContext,
  element: Element,
  pseudo: '::before' | '::after',
  parentBox: IBox,
  path: string,
  order: 'first' | 'last',
): TLayerNode | null {
  const style = ctx.win.getComputedStyle(element, pseudo)
  if (!style.content || style.content === 'none' || style.content === 'normal' || style.display === 'none') return null
  if (parseFloat(style.opacity) === 0 || isCollapsedTransform(style.transform)) return null
  const w = parsePx(style.width)
  const h = parsePx(style.height)
  if (w <= 0 || h <= 0) return null
  const absolute = style.position === 'absolute'
  const shift = translation(style.transform)
  const leftPercent = style.left.endsWith('%') ? (parseFloat(style.left) / 100) * parentBox.w : parsePx(style.left)
  const topPercent = style.top.endsWith('%') ? (parseFloat(style.top) / 100) * parentBox.h : parsePx(style.top)
  // An in-flow pseudo-element sits after the parent's padding and its own margin: otherwise the gap to the
  // neighbour in auto layout comes out larger than the real one by the padding.
  const parentStyle = ctx.win.getComputedStyle(element)
  const inset =
    order === 'first'
      ? parsePx(parentStyle.paddingLeft) + parsePx(parentStyle.borderLeftWidth) + parsePx(style.marginLeft)
      : parsePx(parentStyle.paddingRight) + parsePx(parentStyle.borderRightWidth) + parsePx(style.marginRight)
  const box: IBox = absolute
    ? { x: round(leftPercent + shift.x), y: round(topPercent + shift.y), w, h }
    : { x: order === 'first' ? round(inset) : round(parentBox.w - inset - w), y: round((parentBox.h - h) / 2), w, h }
  // A round pseudo-element is a dot (tone chip, radio), everything else is a mark (the checkbox square).
  const circle = Math.abs(w - h) < 0.01 && parseRadius(style.borderTopLeftRadius, w, h) >= w / 2 - 0.01
  const name = circle ? 'Dot' : 'Mark'
  const maskImage = [style.maskImage, style.getPropertyValue('-webkit-mask-image')].find(
    (value) => value && value !== 'none',
  )
  const mask = maskImage ? svgFromMask(maskImage) : null
  if (mask) {
    const color = colorOf(ctx, style.backgroundColor) ?? { r: 0, g: 0, b: 0, a: 1 }
    const markup = maskToSvg(mask, SVG_TINT, w, h)
    const key = hashString(markup)
    ctx.assets[key] = markup
    return {
      type: 'svg',
      path,
      name: 'Mark',
      box,
      asset: key,
      color: approx(ctx, literal(color)),
      absolute: absolute || undefined,
    }
  }
  const warnings: string[] = []
  const frame: IFrameNode = {
    type: 'frame',
    path,
    name,
    box,
    layout: { mode: 'none' },
    fills: fillsOf(ctx, style, warnings),
    stroke: strokeOf(ctx, style),
    radius: radiusOf(style, box),
    effects: effectsOf(style),
    clip: false,
    children: [],
    absolute: absolute || undefined,
    opacity: parseFloat(style.opacity) < 1 ? parseFloat(style.opacity) : undefined,
  }
  if (warnings.length) frame.warnings = warnings
  return frame.fills.length === 0 && !frame.stroke && frame.effects.length === 0 ? null : frame
}

function inputText(element: Element): { text: string; placeholder: boolean } | null {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element.value) return { text: element.value, placeholder: false }
    if (element.placeholder) return { text: element.placeholder, placeholder: true }
    return { text: '', placeholder: false }
  }
  return null
}

function visit(
  ctx: IWalkContext,
  element: Element,
  parentRect: DOMRect,
  path: string,
  name: string | null,
): TLayerNode | null {
  const style = ctx.win.getComputedStyle(element)
  const elementRect = element.getBoundingClientRect()
  if (isHidden(style, elementRect, element)) return null
  const rect = fieldsetRect(element, style, elementRect)
  const box = relativeBox(rect, parentRect)

  const brightness = parseBrightness(style.filter)
  const scale = transformScale(style.transform)
  const turn = rotationOf(style.transform)
  const inner: IWalkContext =
    brightness === null && scale === 1 && turn === null
      ? ctx
      : {
          ...ctx,
          brightness: ctx.brightness * (brightness ?? 1),
          scale: ctx.scale * scale,
          rotation: turn === null ? ctx.rotation : multiply(ctx.rotation, turn),
        }

  if (element instanceof SVGElement && element.tagName.toLowerCase() === 'svg') {
    return svgLayer(inner, element, style, box, path)
  }
  const warnings: string[] = []
  const input = inputText(element)
  if (input) {
    // An input field is a frame the size of the element with the text centered vertically: the field height is
    // set by its CSS, not by the line. MUI hides the placeholder under a label that is not raised
    // (`::placeholder { opacity: 0 }`): such text is not in the layers, the frame stays empty and holds the size.
    const frame = frameNode(inner, element, style, box, path, name, warnings, [])
    frame.name = layerName(element, 'input')
    const padding: [number, number, number, number] = [
      parsePx(style.paddingTop) + parsePx(style.borderTopWidth),
      parsePx(style.paddingRight) + parsePx(style.borderRightWidth),
      parsePx(style.paddingBottom) + parsePx(style.borderBottomWidth),
      parsePx(style.paddingLeft) + parsePx(style.borderLeftWidth),
    ]
    frame.layout = { mode: 'row', gap: 0, padding, justify: 'min', align: 'center', wrap: false }
    frame.sizing = { w: 'fixed', h: 'fixed' }
    const placeholderStyle = input.placeholder ? ctx.win.getComputedStyle(element, '::placeholder') : null
    const hidden = placeholderStyle !== null && parseFloat(placeholderStyle.opacity) === 0
    if (input.text && !hidden) {
      const merged = Object.create(style) as CSSStyleDeclaration
      if (placeholderStyle) {
        // The browser dims the placeholder with `opacity`, not the color alpha: in the layer it is the same thing.
        const parsed = parseColor(placeholderStyle.color)
        const opacity = parseFloat(placeholderStyle.opacity)
        const value =
          parsed && opacity < 1
            ? `rgba(${Math.round(parsed.r * 255)}, ${Math.round(parsed.g * 255)}, ${Math.round(parsed.b * 255)}, ${parsed.a * opacity})`
            : placeholderStyle.color
        Object.defineProperty(merged, 'color', { value })
      }
      const lineHeight = textStyleOf(merged, inner.scale).lineHeightPx
      const textBox: IBox = {
        x: padding[3],
        y: round((box.h - lineHeight) / 2),
        w: Math.max(1, box.w - padding[1] - padding[3]),
        h: lineHeight,
      }
      frame.children.push(textNode(inner, merged, input.text, textBox, `${path}/0`, false))
    }
    if (warnings.length) frame.warnings = warnings
    return frame
  }

  const childElements = layoutChildren(ctx.win, element)
  const textNodes = [...element.childNodes].filter(
    (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
  )
  const text = textNodes
    .map((node) => node.textContent ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim()

  // An element with only text and no appearance is the text layer itself; with padding or a fill it is a frame
  // with auto layout around the text, so that the label in Figma grows together with the frame.
  if (childElements.length === 0 && text) {
    const padded = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].some(
      (value) => parsePx(value) > 0,
    )
    const plain =
      !padded &&
      fillsOf(inner, style, warnings).length === 0 &&
      !strokeOf(inner, style) &&
      effectsOf(style).length === 0
    const range = ctx.win.document.createRange()
    range.selectNodeContents(element)
    const textBox = relativeBox(range.getBoundingClientRect(), rect)
    // Block text aligned to the center or right is aligned within its own box: the layer holds the box width,
    // otherwise in Figma it is pressed to the start of the parent.
    const aligned = style.display !== 'inline' && /^(center|right|end|-webkit-center)$/.test(style.textAlign)
    const multiline = (textBox.h || box.h) > textStyleOf(style, inner.scale).lineHeightPx * 1.5
    // A label in a row wider than its text (an 88px column of row labels): the block width sets the place of
    // the neighbours to the right; sized by text, the gap after the label would come out wider than the others.
    const wideInRow = style.display !== 'inline' && box.w > textBox.w + 0.5 && isRowItem(ctx.win, element)
    if (plain) {
      if ((aligned || wideInRow) && !multiline) {
        return alignedLine(inner, element, style, text, box, textBox, path, name, warnings)
      }
      // Multiline text holds the box width: sized by the longest line, Figma with its slightly wider metrics
      // would wrap differently. A word wider than the box is let past the edge by the browser but broken by
      // Figma, so then the width follows the text. A line truncated with an ellipsis holds the box width: sized
      // by text, the layer would be wider by the whole truncated part.
      const truncated = !multiline && isEllipsis(style) && textBox.w > box.w + 0.5
      const width = multiline ? Math.max(box.w, textBox.w) : truncated ? box.w : Math.min(box.w, textBox.w) || box.w
      const x = multiline && textBox.w > box.w ? round(box.x + textBox.x) : box.x
      return textNode(
        inner,
        style,
        text,
        { x, y: box.y, w: width, h: textBox.h || box.h },
        path,
        aligned || multiline || truncated,
        style.display === 'inline',
      )
    }
    const frame = frameNode(inner, element, style, box, path, name, warnings, [])
    const content = contentBox(style, box)
    // A line with an ellipsis (a chip label in a narrow cell) holds the content area width and is truncated.
    const cut = !multiline && isEllipsis(style) && textBox.w > content.w + 0.5
    const layerBox = multiline
      ? { ...textBox, x: Math.min(textBox.x, content.x), w: Math.max(textBox.w, content.w) }
      : cut
        ? { ...textBox, x: content.x, w: content.w }
        : textBox
    frame.children.push(textNode(inner, style, text, layerBox, `${path}/0`, multiline || cut))
    frame.layout = isFlex(style.display) ? flexLayout(style, [layerBox]) : blockLayout(style)
    frame.layout = absorbOffsets(frame.layout, [layerBox], box)
    frame.sizing = sizingOf(style, frame.layout, box, frame.children, path === '')
    return frame
  }

  const frame = frameNode(inner, element, style, box, path, name, warnings, [])
  let children: TLayerNode[] = []
  // CSS paint order: absolute children are drawn over the flow (negative z-index goes under it).
  const zIndex = new Map<TLayerNode, number>()
  const pseudoZ = (pseudo: '::before' | '::after') =>
    parseInt(ctx.win.getComputedStyle(element, pseudo).zIndex, 10) || 0
  const before = pseudoNode(inner, element, '::before', box, `${path}/before`, 'first')
  if (before) {
    children.push(before)
    if (before.absolute) zIndex.set(before, pseudoZ('::before'))
  }
  let index = 0
  const childStyles: CSSStyleDeclaration[] = []
  const flowStyles: CSSStyleDeclaration[] = []
  for (const child of childElements) {
    const node = visit(inner, child, rect, `${path}/${index}`, null)
    if (!node) continue
    const childStyle = ctx.win.getComputedStyle(child)
    if (childStyle.position === 'absolute' || childStyle.position === 'fixed') {
      // An empty invisible layer on top (the ripple container, the focus overlay) is not needed in the design.
      if (
        node.type === 'frame' &&
        node.children.length === 0 &&
        node.fills.length === 0 &&
        !node.stroke &&
        node.effects.length === 0
      )
        continue
      node.absolute = true
      zIndex.set(node, parseInt(childStyle.zIndex, 10) || 0)
    } else {
      flowStyles.push(childStyle)
    }
    if (parseFloat(childStyle.flexGrow) > 0) node.grow = 1
    if (childStyle.alignSelf !== 'auto' && childStyle.alignSelf !== 'normal') {
      node.alignSelf =
        childStyle.alignSelf === 'stretch'
          ? 'stretch'
          : childStyle.alignSelf.includes('end')
            ? 'max'
            : childStyle.alignSelf === 'center'
              ? 'center'
              : 'min'
    }
    children.push(node)
    childStyles.push(childStyle)
    index += 1
  }
  if (text) {
    const content = contentBox(style, box)
    const lineHeight = textStyleOf(style, inner.scale).lineHeightPx
    for (const node of textNodes) {
      const range = ctx.win.document.createRange()
      range.selectNodeContents(node)
      const textRect = range.getBoundingClientRect()
      if (textRect.width === 0) continue
      const textBox = relativeBox(textRect, rect)
      // A multiline piece of text wraps by the element's content width, not by its own longest line; a line
      // with an ellipsis holds the content area width.
      const multiline = textBox.h > lineHeight * 1.5
      const cut = !multiline && isEllipsis(style) && textBox.x + textBox.w > content.x + content.w + 0.5
      const layerBox = multiline
        ? { ...textBox, x: Math.min(textBox.x, content.x), w: Math.max(textBox.w, content.w) }
        : cut
          ? { ...textBox, w: Math.max(1, round(content.x + content.w - textBox.x)) }
          : textBox
      children.push(
        textNode(
          inner,
          style,
          (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
          layerBox,
          `${path}/t${index}`,
          multiline || cut,
        ),
      )
      index += 1
    }
  }
  const after = pseudoNode(inner, element, '::after', box, `${path}/after`, 'last')
  if (after) {
    children.push(after)
    if (after.absolute) zIndex.set(after, pseudoZ('::after'))
  }

  const flowing = children.filter((child) => !child.absolute)
  if (isFlex(style.display)) {
    frame.layout = flexLayout(
      style,
      flowing.map((child) => child.box),
      box,
    )
    absorbEdgeMargins(frame.layout, flowStyles[0] ?? null, flowStyles[flowStyles.length - 1] ?? null)
    if (style.flexDirection.endsWith('-reverse') && frame.layout.mode !== 'none') flowing.reverse()
  } else if (flowing.length > 0 && isStack(flowing.map((child) => child.box))) {
    // A block container with a stack of children (CardContent, an item label) is an auto layout column.
    frame.layout = stackLayout(
      style,
      flowing.map((child) => child.box),
      flowing.every((child) => child.type === 'text'),
    )
  }
  void childStyles
  frame.layout = absorbOffsets(
    frame.layout,
    flowing.map((child) => child.box),
    box,
  )
  // Hug-sized text and full-width text look the same, so only frames and icons are marked.
  const loose = unstretched(
    frame.layout,
    flowing.map((child) => child.box),
    box,
  )
  flowing.forEach((child, index) => {
    if (loose[index] && child.type !== 'text' && child.alignSelf === undefined) child.alignSelf = 'min'
  })
  const positioned = children.filter((child) => child.absolute)
  const byZ = (a: TLayerNode, b: TLayerNode) => (zIndex.get(a) ?? 0) - (zIndex.get(b) ?? 0)
  children = [
    ...positioned.filter((child) => (zIndex.get(child) ?? 0) < 0).sort(byZ),
    ...flowing,
    ...positioned.filter((child) => (zIndex.get(child) ?? 0) >= 0).sort(byZ),
  ]
  if ((rect.width === 0 || rect.height === 0) && children.length === 0) return null
  frame.sizing = sizingOf(style, frame.layout, box, children, path === '')
  frame.children = children
  if (style.minWidth !== 'auto' && style.minWidth !== '0px' && !style.minWidth.endsWith('%'))
    frame.minWidth = parsePx(style.minWidth)
  if (style.minHeight !== 'auto' && style.minHeight !== '0px' && !style.minHeight.endsWith('%'))
    frame.minHeight = parsePx(style.minHeight)
  return frame
}

/** Children lie one below another without overlaps: each next one starts no higher than the previous one's end. */
function isStack(boxes: IBox[]): boolean {
  for (let i = 1; i < boxes.length; i += 1) {
    const prev = boxes[i - 1]
    if (boxes[i].y < prev.y + prev.h - 0.5) return false
  }
  return true
}

function stackLayout(style: CSSStyleDeclaration, boxes: IBox[], textOnly = false): TLayout {
  if (gapsVary(boxes, false)) return { mode: 'none' }
  const gap = uniformGap(boxes, false)
  const padding: [number, number, number, number] = [
    parsePx(style.paddingTop) + parsePx(style.borderTopWidth),
    parsePx(style.paddingRight) + parsePx(style.borderRightWidth),
    parsePx(style.paddingBottom) + parsePx(style.borderBottomWidth),
    parsePx(style.paddingLeft) + parsePx(style.borderLeftWidth),
  ]
  // Text lines are aligned by the block's `text-align`; it does not move block children.
  const align = !textOnly
    ? 'min'
    : /center/.test(style.textAlign)
      ? 'center'
      : /right|end/.test(style.textAlign)
        ? 'max'
        : 'min'
  return { mode: 'column', gap: gap ?? 0, padding, justify: 'min', align, wrap: false }
}

/**
 * Sizing behaviour from the slack between the box and the content: if the browser rendered the frame larger
 * than its children with padding (explicit `height`/`width`, `min-*`, stretching by the parent), the size in
 * Figma stays fixed, otherwise it hugs the content. An explicit `max-width` also means a fixed width. Absolute
 * children are not part of the content. Content wider or taller than the box (table scrolling, `overflow`
 * clipping) also means a fixed size: a hug-sized frame in Figma would grow to it.
 */
function sizingOf(
  style: CSSStyleDeclaration,
  layout: TLayout,
  box: IBox,
  children: TLayerNode[],
  isRoot: boolean,
): { w: TSizing; h: TSizing } {
  const flowing = children.filter((child) => !child.absolute)
  const padding = layout.mode === 'none' ? [0, 0, 0, 0] : layout.padding
  const right = flowing.reduce((max, child) => Math.max(max, child.box.x + child.box.w), 0) + padding[1]
  const bottom = flowing.reduce((max, child) => Math.max(max, child.box.y + child.box.h), 0) + padding[2]
  // Content pressed to the end or center (`justify-content: flex-end`, `text-align: right`): free space at the
  // start is also a sign of a size not set by the content.
  const left = flowing.reduce((min, child) => Math.min(min, child.box.x), Infinity) - padding[3]
  const top = flowing.reduce((min, child) => Math.min(min, child.box.y), Infinity) - padding[0]
  const startSlackW = flowing.length > 0 && left > 1
  const startSlackH = flowing.length > 0 && top > 1
  const slackW = flowing.length === 0 || box.w - right > 1 || startSlackW
  const slackH = flowing.length === 0 || box.h - bottom > 1 || startSlackH
  const overflowW = flowing.length > 0 && right - box.w > 1
  const overflowH = flowing.length > 0 && bottom - box.h > 1
  const maxWidth = /px$/.test(style.maxWidth)
  // A wrapping row in Figma wraps lines only with a fixed width.
  const wrap = layout.mode !== 'none' && layout.wrap
  // A story root with `display: flex` is stretched by the story container, not by its own width: the component
  // in Figma hugs its content. Inside the tree such a block holds its width (table cell, pagination bar, tab).
  const stretched = isRoot && style.display === 'flex' && !maxWidth && !startSlackW
  const w: TSizing = maxWidth || wrap || overflowW || (slackW && !stretched) ? 'fixed' : 'hug'
  const h: TSizing = slackH || overflowH ? 'fixed' : 'hug'
  return { w, h }
}

/**
 * Element children for layout; `display: contents` has no box of its own, so its children take its place
 * (DataGrid wrappers).
 */
function layoutChildren(win: Window, element: Element): Element[] {
  const result: Element[] = []
  for (const child of element.children) {
    if (child.tagName === 'SCRIPT' || child.tagName === 'STYLE' || child.tagName === 'TEMPLATE') continue
    if (win.getComputedStyle(child).display === 'contents') result.push(...layoutChildren(win, child))
    else result.push(child)
  }
  return result
}

/** Content area of the element in its own coordinates: the box without the border and padding. */
function contentBox(style: CSSStyleDeclaration, box: IBox): IBox {
  const left = parsePx(style.paddingLeft) + parsePx(style.borderLeftWidth)
  const top = parsePx(style.paddingTop) + parsePx(style.borderTopWidth)
  const right = parsePx(style.paddingRight) + parsePx(style.borderRightWidth)
  const bottom = parsePx(style.paddingBottom) + parsePx(style.borderBottomWidth)
  return { x: left, y: top, w: Math.max(0, round(box.w - left - right)), h: Math.max(0, round(box.h - top - bottom)) }
}

/** The element is an item of a flex row (parents with `display: contents` are skipped). */
function isRowItem(win: Window, element: Element): boolean {
  let parent = element.parentElement
  while (parent) {
    const style = win.getComputedStyle(parent)
    if (style.display !== 'contents') return isFlex(style.display) && style.flexDirection.startsWith('row')
    parent = parent.parentElement
  }
  return false
}

/**
 * Single-line text in a block wider than the text (aligned to the center or right, a fixed-width label in a
 * row): a row as wide as the block and hug-sized text. Figma with its slightly wider metrics would wrap
 * fixed-width text onto a second line.
 */
function alignedLine(
  ctx: IWalkContext,
  element: Element,
  style: CSSStyleDeclaration,
  text: string,
  box: IBox,
  textBox: IBox,
  path: string,
  name: string | null,
  warnings: string[],
): IFrameNode {
  const frame = frameNode(ctx, element, style, box, path, name, warnings, [])
  const top = Math.max(0, round(textBox.y))
  frame.layout = {
    mode: 'row',
    gap: 0,
    padding: [top, 0, 0, 0],
    justify: /center/.test(style.textAlign) ? 'center' : /^(right|end)$/.test(style.textAlign) ? 'max' : 'min',
    align: 'min',
    wrap: false,
  }
  frame.sizing = { w: 'fixed', h: box.h - (top + textBox.h) > 1 ? 'fixed' : 'hug' }
  frame.children = [textNode(ctx, style, text, textBox, `${path}/0`, false)]
  return frame
}

/** A block container with a single text: a row with the CSS padding and alignment from the text. */
function blockLayout(style: CSSStyleDeclaration): TLayout {
  const padding: [number, number, number, number] = [
    parsePx(style.paddingTop) + parsePx(style.borderTopWidth),
    parsePx(style.paddingRight) + parsePx(style.borderRightWidth),
    parsePx(style.paddingBottom) + parsePx(style.borderBottomWidth),
    parsePx(style.paddingLeft) + parsePx(style.borderLeftWidth),
  ]
  const justify =
    style.textAlign === 'center' ? 'center' : style.textAlign === 'right' || style.textAlign === 'end' ? 'max' : 'min'
  return { mode: 'row', gap: 0, padding, justify, align: 'center', wrap: false }
}

function frameNode(
  ctx: IWalkContext,
  element: Element,
  style: CSSStyleDeclaration,
  box: IBox,
  path: string,
  name: string | null,
  warnings: string[],
  children: TLayerNode[],
): IFrameNode {
  const frame: IFrameNode = {
    type: 'frame',
    path,
    name: name ?? layerName(element, element.tagName.toLowerCase()),
    box,
    layout: { mode: 'none' },
    fills: fillsOf(ctx, style, warnings),
    stroke: strokeOf(ctx, style),
    radius: radiusOf(style, box),
    effects: effectsOf(style),
    clip: ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflow),
    children,
  }
  const opacity = parseFloat(style.opacity)
  if (opacity < 1) frame.opacity = opacity
  if (warnings.length) frame.warnings = warnings
  const classes = signatureOf(element)
  if (classes.length > 0) frame.classes = classes
  return frame
}

/**
 * Root appearance from ancestors of the same size: a card image is rounded and clipped by the Card around it,
 * the background of the clickable area comes from the Card. The story screenshot shows this, so the root takes
 * from ancestors with a matching box the fill, the corner radius with clipping, the stroke and the shadows it
 * does not have itself.
 */
function inheritAppearance(ctx: IWalkContext, root: Element, tree: IFrameNode): void {
  const rect = root.getBoundingClientRect()
  const near = (x: number, y: number) => Math.abs(x - y) <= 1
  const matches = (other: { x: number; y: number; width: number; height: number }) =>
    near(other.x, rect.x) && near(other.y, rect.y) && near(other.width, rect.width) && near(other.height, rect.height)
  for (let element = root.parentElement; element; element = element.parentElement) {
    if (element === ctx.win.document.body || element.id === 'storybook-root' || element.id === 'root') break
    const style = ctx.win.getComputedStyle(element)
    const outer = element.getBoundingClientRect()
    // A match by the outer box or by the box inside the border (a Card with a 1 px stroke around the image).
    const border = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].map(
      (value) => parsePx(value),
    )
    const inner = {
      x: outer.x + border[3],
      y: outer.y + border[0],
      width: outer.width - border[1] - border[3],
      height: outer.height - border[0] - border[2],
    }
    const insideBorder = !matches(outer) && matches(inner)
    if (!matches(outer) && !insideBorder) break
    const warnings: string[] = []
    if (tree.fills.length === 0) tree.fills = fillsOf(ctx, style, warnings)
    if (tree.radius.values.every((value) => value === 0)) {
      const radius = radiusOf(style, tree.box)
      if (radius.values.some((value) => value > 0)) {
        // Inside the border the corner radius is smaller by its width.
        const inset = insideBorder ? Math.max(...border) : 0
        tree.radius = {
          ...radius,
          values: radius.values.map((value) => Math.max(0, value - inset)) as typeof radius.values,
        }
        if (['hidden', 'clip'].includes(style.overflow)) tree.clip = true
      }
    }
    // An ancestor carries the border and shadow outside the root box: inside the border they are not carried over.
    if (insideBorder) continue
    if (!tree.stroke) tree.stroke = strokeOf(ctx, style)
    if (tree.effects.length === 0) tree.effects = effectsOf(style)
    if (!tree.stroke) delete tree.stroke
  }
}

/** Layer tree of the root with the given name; `signature` is the semantic classes of the root. */
export function captureElement(win: Window, root: Element, name: string): ICaptureResult {
  const assets: Record<string, string> = {}
  const ctx: IWalkContext = { win, assets, brightness: 1, scale: 1, rotation: IDENTITY }
  const parentRect = root.getBoundingClientRect()
  let tree = visit(ctx, root, new DOMRect(parentRect.x, parentRect.y, 0, 0), '', name)
  if (!tree) throw new Error(`Корень ${name} невидим или пуст`)
  tree.box = { ...tree.box, x: 0, y: 0 }
  // The variant root is always a frame: a component made of a single text (TruncatedText) is wrapped in a
  // hug-sized row.
  if (tree.type !== 'frame') {
    const inner = { ...tree, path: '/0', name: tree.type === 'text' ? 'Label' : tree.name }
    tree = {
      type: 'frame',
      path: '',
      name,
      box: tree.box,
      layout: { mode: 'row', gap: 0, padding: [0, 0, 0, 0], justify: 'min', align: 'center', wrap: false },
      sizing: { w: 'hug', h: 'hug' },
      fills: [],
      radius: { values: [0, 0, 0, 0] },
      effects: [],
      clip: false,
      children: [inner],
    }
  }
  inheritAppearance(ctx, root, tree)
  // The variant signature is the classes of the root and the first-level children: for a field, the inner
  // Input carries the look and the size.
  const children = tree.type === 'frame' ? tree.children : []
  const childClasses = children.flatMap((child) =>
    child.type === 'frame' ? (child.classes ?? []).map((name) => `>${name}`) : [],
  )
  return { tree, signature: [...signatureOf(root), ...childClasses], assets, stretched: isStretched(win, root) }
}

/** A root as wide as the parent's content area or the window: its width is set by the page. */
function isStretched(win: Window, root: Element): boolean {
  const width = root.getBoundingClientRect().width
  if (Math.abs(width - win.innerWidth) <= 1) return true
  const parent = root.parentElement
  if (!parent) return false
  const style = win.getComputedStyle(parent)
  const inner =
    parent.getBoundingClientRect().width -
    parsePx(style.paddingLeft) -
    parsePx(style.paddingRight) -
    parsePx(style.borderLeftWidth) -
    parsePx(style.borderRightWidth)
  return Math.abs(width - inner) <= 1
}
