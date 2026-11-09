/*
 * CSS flex layout → Figma auto layout. The gap and the edge padding are taken from the children's geometry: MUI
 * hands them out not only with `gap` but also with margins (`Stack`, button icons), which Figma does not have.
 */

import { parsePx } from './css.ts'
import type { IBox, TLayout } from './types.ts'

const JUSTIFY: Record<string, 'min' | 'center' | 'max' | 'space-between'> = {
  'flex-start': 'min',
  start: 'min',
  normal: 'min',
  left: 'min',
  center: 'center',
  'flex-end': 'max',
  end: 'max',
  right: 'max',
  'space-between': 'space-between',
  'space-around': 'space-between',
  'space-evenly': 'space-between',
}

const ALIGN: Record<string, 'min' | 'center' | 'max' | 'baseline' | 'stretch'> = {
  'flex-start': 'min',
  start: 'min',
  center: 'center',
  'flex-end': 'max',
  end: 'max',
  baseline: 'baseline',
  normal: 'stretch',
  stretch: 'stretch',
}

export function isFlex(display: string): boolean {
  return display === 'flex' || display === 'inline-flex'
}

/** Gap between neighbours along the main axis, if it is the same for all pairs (with a half-pixel tolerance). */
export function uniformGap(boxes: IBox[], horizontal: boolean): number | null {
  if (boxes.length < 2) return null
  const gaps: number[] = []
  for (let i = 1; i < boxes.length; i += 1) {
    const prev = boxes[i - 1]
    const next = boxes[i]
    gaps.push(horizontal ? next.x - (prev.x + prev.w) : next.y - (prev.y + prev.h))
  }
  const first = gaps[0]
  if (gaps.some((gap) => Math.abs(gap - first) > 1 || gap < 0)) return null
  return Math.round(first * 100) / 100
}

/**
 * The gaps between children differ (`margin` on individual children, overlaps): auto layout with a single gap
 * would shift the children, so such a container is left without a layout and the children stay in place.
 */
export function gapsVary(boxes: IBox[], horizontal: boolean): boolean {
  return boxes.length >= 2 && uniformGap(boxes, horizontal) === null
}

/**
 * Gaps of a wrapping row from geometry: within a line (along the main axis) and between lines (along the cross
 * axis). MUI Stack without `useFlexGap` spaces children with margins rather than `gap`, so CSS will not show
 * them. `null` means the gaps within lines or between lines differ.
 */
export function wrapGaps(boxes: IBox[], horizontal: boolean): { main: number | null; cross: number | null } {
  const lines = wrapLines(boxes, horizontal)
  const mains = lines.filter((line) => line.length > 1).map((line) => uniformGap(line, horizontal))
  const main =
    mains.length > 0 && mains.every((gap) => gap !== null && Math.abs(gap - (mains[0] ?? 0)) <= 1) ? mains[0] : null
  const spans = lines.map((line) => ({
    start: Math.min(...line.map((box) => (horizontal ? box.y : box.x))),
    end: Math.max(...line.map((box) => (horizontal ? box.y + box.h : box.x + box.w))),
  }))
  const crosses = spans.slice(1).map((span, index) => span.start - spans[index].end)
  const cross =
    crosses.length > 0 && crosses.every((gap) => gap >= 0 && Math.abs(gap - crosses[0]) <= 1)
      ? Math.round(crosses[0] * 100) / 100
      : null
  return { main: main ?? null, cross }
}

/** Lines of a wrapping row in the browser: a child that returns to the start of the main axis opens a new line. */
function wrapLines(boxes: IBox[], horizontal: boolean): IBox[][] {
  const lines: IBox[][] = []
  for (const box of boxes) {
    const line = lines[lines.length - 1]
    const prev = line?.[line.length - 1]
    if (!line || (horizontal ? box.x : box.y) < (horizontal ? prev.x : prev.y) + 0.5) lines.push([box])
    else line.push(box)
  }
  return lines
}

/** The wrapping row has a line of at least two children, so there is a gap to measure. */
function rowsWithNeighbours(boxes: IBox[], horizontal: boolean): boolean {
  return boxes.some(
    (box, index) =>
      index > 0 && (horizontal ? box.x : box.y) >= (horizontal ? boxes[index - 1].x : boxes[index - 1].y) + 0.5,
  )
}

/**
 * A wrapping row filled edge to edge: at least two children in one line, and with the CSS gaps they take the
 * whole width without padding. There is no free space, so text in Figma, which can be wider than in the
 * browser, would wrap the last child.
 */
function filledLine(boxes: IBox[], horizontal: boolean, cssGap: number, inner: number): boolean {
  if (boxes.length < 2 || wrapLines(boxes, horizontal).length > 1) return false
  const used = boxes.reduce((sum, box) => sum + (horizontal ? box.w : box.h), 0) + cssGap * (boxes.length - 1)
  return used >= inner - 1
}

/** `size` is the container box: it shows whether the wrapping row is filled edge to edge. */
export function flexLayout(style: CSSStyleDeclaration, childBoxes: IBox[], size?: IBox): TLayout {
  const direction = style.flexDirection
  const horizontal = direction === 'row' || direction === 'row-reverse'
  const cssGap = parsePx(horizontal ? style.columnGap : style.rowGap)
  const padding: [number, number, number, number] = [
    parsePx(style.paddingTop) + parsePx(style.borderTopWidth),
    parsePx(style.paddingRight) + parsePx(style.borderRightWidth),
    parsePx(style.paddingBottom) + parsePx(style.borderBottomWidth),
    parsePx(style.paddingLeft) + parsePx(style.borderLeftWidth),
  ]
  const inner = size ? (horizontal ? size.w - padding[1] - padding[3] : size.h - padding[0] - padding[2]) : Infinity
  // A row filled edge to edge (DataTable toolbar filters) is exported without wrapping. A row with free space
  // (filters on the left, actions on the right) wraps as in the browser: wrapping holds its width.
  const wrap =
    (style.flexWrap === 'wrap' || style.flexWrap === 'wrap-reverse') &&
    !filledLine(childBoxes, horizontal, cssGap, inner)
  // Without wrapping, unequal gaps mean margins on the children, and such a row is left without a layout; in a
  // wrapping row the gaps are measured per line.
  if (!wrap && gapsVary(childBoxes, horizontal)) return { mode: 'none' }
  const lines = wrap ? wrapGaps(childBoxes, horizontal) : null
  // Auto layout cannot express differing gaps within the lines of a wrapping row either: the CSS `gap` (zero
  // for Stack without `useFlexGap`) would push the children together. The children stay in place.
  if (lines && lines.main === null && rowsWithNeighbours(childBoxes, horizontal)) return { mode: 'none' }
  const measured = wrap ? (lines?.main ?? null) : uniformGap(childBoxes, horizontal)
  const crossGap = wrap ? (lines?.cross ?? parsePx(horizontal ? style.rowGap : style.columnGap)) : undefined
  return {
    mode: horizontal ? 'row' : 'column',
    gap: measured ?? cssGap,
    padding,
    justify: JUSTIFY[style.justifyContent] ?? 'min',
    align: ALIGN[style.alignItems] ?? 'stretch',
    wrap,
    ...(crossGap !== undefined ? { crossGap } : {}),
  }
}

/** Edge margins of the children along the main axis are added to the container padding (Figma has no margins). */
/**
 * The spacing before the first child is taken from geometry when it is larger than the CSS padding: otherwise
 * the `margin` of a child or of a pseudo-element (chip dot, StepContent shifted under the icon) is lost in auto
 * layout. Only for axes aligned to the start: on centered ones the spacing comes from alignment, not a margin.
 */
export function absorbOffsets(layout: TLayout, boxes: IBox[], size: { w: number; h: number }): TLayout {
  if (layout.mode === 'none' || boxes.length === 0) return layout
  const horizontal = layout.mode === 'row'
  const minX = Math.min(...boxes.map((box) => box.x))
  const minY = Math.min(...boxes.map((box) => box.y))
  const maxX = Math.max(...boxes.map((box) => box.x + box.w))
  const maxY = Math.max(...boxes.map((box) => box.y + box.h))
  const round = (value: number) => Math.round(value * 100) / 100
  const mainStart = horizontal ? minX : minY
  const crossStart = horizontal ? minY : minX
  const mainIndex = horizontal ? 3 : 0
  const crossIndex = horizontal ? 0 : 3
  // Auto layout cannot express content beyond the box edge (negative margins): the children stay in place.
  if (minX < -0.5 || minY < -0.5) return { mode: 'none' }
  // The content does not fit within the CSS padding (a vertical fullWidth tab is squeezed to the height of its
  // padding, the text spills into it): the padding is taken from geometry, otherwise a content-sized frame in
  // Figma would grow by the difference.
  const fit = (startIndex: number, endIndex: number, start: number, end: number, extent: number) => {
    if (start < layout.padding[startIndex] - 0.5) layout.padding[startIndex] = round(start)
    if (end > extent - layout.padding[endIndex] + 0.5) layout.padding[endIndex] = round(Math.max(0, extent - end))
  }
  fit(3, 1, minX, maxX, size.w)
  fit(0, 2, minY, maxY, size.h)
  // Centering does not explain asymmetric margins (a chip dot with `margin-left`): the content is pressed to
  // the start and there is no free space, so the layout is counted from the start.
  if (layout.justify === 'center') {
    const end = Math.max(...boxes.map((box) => (horizontal ? box.x + box.w : box.y + box.h)))
    const before = mainStart - layout.padding[mainIndex]
    const after = (horizontal ? size.w : size.h) - end - layout.padding[horizontal ? 1 : 2]
    if (Math.abs(before - after) > 1) layout.justify = 'min'
  }
  if (layout.justify === 'min' && mainStart > layout.padding[mainIndex] + 0.5)
    layout.padding[mainIndex] = round(mainStart)
  if (layout.align === 'min' || layout.align === 'stretch') {
    // Differing child offsets along the cross axis are margins of individual children (StepContent shifted
    // under the icon): auto layout cannot express them, the container is left without a layout, the children
    // stay in place.
    const starts = boxes.map((box) => (horizontal ? box.y : box.x))
    if (Math.max(...starts) - Math.min(...starts) > 1) return { mode: 'none' }
    if (crossStart > layout.padding[crossIndex] + 0.5) layout.padding[crossIndex] = round(crossStart)
  }
  return layout
}

/**
 * Children that `align-items: stretch` (and `normal`) did not stretch: they have their own size along the cross
 * axis (a 22×22 icon in the Alert icon column). FILL in Figma would stretch them to the full row height.
 */
export function unstretched(layout: TLayout, boxes: IBox[], size: { w: number; h: number }): boolean[] {
  if (layout.mode === 'none' || layout.align !== 'stretch') return boxes.map(() => false)
  const horizontal = layout.mode === 'row'
  const extent = horizontal
    ? size.h - layout.padding[0] - layout.padding[2]
    : size.w - layout.padding[3] - layout.padding[1]
  return boxes.map((box) => (horizontal ? box.h : box.w) < extent - 0.5)
}

export function absorbEdgeMargins(
  layout: TLayout,
  first: CSSStyleDeclaration | null,
  last: CSSStyleDeclaration | null,
): void {
  if (layout.mode === 'none') return
  const horizontal = layout.mode === 'row'
  if (first) {
    const start = parsePx(horizontal ? first.marginLeft : first.marginTop)
    if (horizontal) layout.padding[3] = Math.max(0, layout.padding[3] + start)
    else layout.padding[0] = Math.max(0, layout.padding[0] + start)
  }
  if (last) {
    const end = parsePx(horizontal ? last.marginRight : last.marginBottom)
    if (horizontal) layout.padding[1] = Math.max(0, layout.padding[1] + end)
    else layout.padding[2] = Math.max(0, layout.padding[2] + end)
  }
}
