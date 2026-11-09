/*
 * Flex-раскладка CSS → auto layout Figma. Промежуток и крайние отступы берутся из геометрии детей: MUI
 * раздаёт их не только `gap`, но и маржинами (`Stack`, иконки кнопки), которых в Figma нет.
 */

import { parsePx } from './css'
import type { IBox, TLayout } from './types'

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

/** Промежуток между соседями по главной оси, если он одинаков у всех пар (с допуском в полпикселя). */
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
 * Промежутки между детьми разные (отступы `margin` у отдельных детей, наложения): auto layout с одним gap
 * сдвинул бы детей, поэтому такой контейнер остаётся без раскладки, а дети - на своих местах.
 */
export function gapsVary(boxes: IBox[], horizontal: boolean): boolean {
  return boxes.length >= 2 && uniformGap(boxes, horizontal) === null
}

/**
 * Промежутки переносимого ряда из геометрии: внутри строки (по главной оси) и между строками (по поперечной).
 * Stack MUI без `useFlexGap` разносит детей полями, а не `gap`, - CSS их не покажет. `null` - промежутки
 * внутри строк или между строками разные.
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

/** Строки переносимого ряда в браузере: ребёнок, вернувшийся к началу по главной оси, открывает новую строку. */
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

/** В переносимом ряду есть строка хотя бы из двух детей - есть что мерить промежутком. */
function rowsWithNeighbours(boxes: IBox[], horizontal: boolean): boolean {
  return boxes.some(
    (box, index) =>
      index > 0 && (horizontal ? box.x : box.y) >= (horizontal ? boxes[index - 1].x : boxes[index - 1].y) + 0.5,
  )
}

/**
 * Переносимый ряд, заполненный впритык: в одной строке хотя бы два ребёнка, и с промежутками из CSS они занимают
 * всю ширину без отступов. Свободного места нет - текст в Figma, который бывает шире браузерного, перенёс бы
 * последнего ребёнка.
 */
function filledLine(boxes: IBox[], horizontal: boolean, cssGap: number, inner: number): boolean {
  if (boxes.length < 2 || wrapLines(boxes, horizontal).length > 1) return false
  const used = boxes.reduce((sum, box) => sum + (horizontal ? box.w : box.h), 0) + cssGap * (boxes.length - 1)
  return used >= inner - 1
}

/** `size` - бокс контейнера: по нему видно, заполнен ли переносимый ряд впритык. */
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
  // Ряд, заполненный впритык (фильтры панели DataTable), выгружается без переноса. Ряд со свободным местом
  // (фильтры слева, действия справа) переносит, как в браузере: его ширину держит перенос.
  const wrap =
    (style.flexWrap === 'wrap' || style.flexWrap === 'wrap-reverse') &&
    !filledLine(childBoxes, horizontal, cssGap, inner)
  // Без переноса неравные промежутки означают поля у детей - такой ряд остаётся без раскладки; в переносимом
  // ряду промежутки меряются по строкам.
  if (!wrap && gapsVary(childBoxes, horizontal)) return { mode: 'none' }
  const lines = wrap ? wrapGaps(childBoxes, horizontal) : null
  // Разные промежутки внутри строк переносимого ряда auto layout тоже не выразит: `gap` из CSS (у Stack без
  // `useFlexGap` он нулевой) сдвинул бы детей вплотную. Дети остаются на своих местах.
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

/** Крайние маржины детей вдоль главной оси добавляются к отступам контейнера (в Figma маржинов нет). */
/**
 * Отступ до первого ребёнка берётся из геометрии, если он больше CSS-padding: поле `margin` у ребёнка
 * или у псевдоэлемента (точка чипа, StepContent со сдвигом под иконку) в auto layout иначе теряется.
 * Только для прижатых к началу осей - у центрированных отступ даёт выравнивание, а не поле.
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
  // Содержимое за краем бокса (отрицательные поля) auto layout не выразит: дети остаются на своих местах.
  if (minX < -0.5 || minY < -0.5) return { mode: 'none' }
  // Содержимое не умещается в отступы CSS (вертикальная вкладка fullWidth сжата до высоты своих отступов, текст
  // выходит в поля): отступы берутся из геометрии, иначе по содержимому фрейм в Figma вырос бы на их разницу.
  const fit = (startIndex: number, endIndex: number, start: number, end: number, extent: number) => {
    if (start < layout.padding[startIndex] - 0.5) layout.padding[startIndex] = round(start)
    if (end > extent - layout.padding[endIndex] + 0.5) layout.padding[endIndex] = round(Math.max(0, extent - end))
  }
  fit(3, 1, minX, maxX, size.w)
  fit(0, 2, minY, maxY, size.h)
  // Центрирование не объясняет несимметричные поля (точка чипа с `margin-left`): содержимое прижато к
  // началу, а свободного места нет - раскладка считается от начала.
  if (layout.justify === 'center') {
    const end = Math.max(...boxes.map((box) => (horizontal ? box.x + box.w : box.y + box.h)))
    const before = mainStart - layout.padding[mainIndex]
    const after = (horizontal ? size.w : size.h) - end - layout.padding[horizontal ? 1 : 2]
    if (Math.abs(before - after) > 1) layout.justify = 'min'
  }
  if (layout.justify === 'min' && mainStart > layout.padding[mainIndex] + 0.5)
    layout.padding[mainIndex] = round(mainStart)
  if (layout.align === 'min' || layout.align === 'stretch') {
    // Разные отступы детей по поперечной оси - поля отдельных детей (StepContent со сдвигом под иконку):
    // auto layout их не выразит, контейнер остаётся без раскладки, дети на своих местах.
    const starts = boxes.map((box) => (horizontal ? box.y : box.x))
    if (Math.max(...starts) - Math.min(...starts) > 1) return { mode: 'none' }
    if (crossStart > layout.padding[crossIndex] + 0.5) layout.padding[crossIndex] = round(crossStart)
  }
  return layout
}

/**
 * Дети, которых `align-items: stretch` (и `normal`) не растянул: у них свой размер по поперечной оси (иконка
 * 22×22 в колонке иконки Alert). FILL в Figma растянул бы их на всю высоту ряда.
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
