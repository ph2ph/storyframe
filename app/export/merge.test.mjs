import { describe, expect, it } from 'vitest'
import { buildPairIndex, matchPair } from './colorMatch.mjs'
import { bindRadii, createMergeReport, mergeTrees } from './merge.mjs'

const INK = { r: 0.251, g: 0.2431, b: 0.2353, a: 1 }
const BLUSH = { r: 0.8902, g: 0.5176, b: 0.4941, a: 1 }
const WHITE = { r: 1, g: 1, b: 1, a: 1 }
const CHARCOAL = { r: 0.102, g: 0.102, b: 0.102, a: 1 }

// Группы и приоритеты - как их задаёт адаптер MUI (`MUI_COLOR_PRIORITY`): ядро адресов не разбирает.
const COLORS = [
  {
    id: 'palette.primary.main',
    name: 'primary/main',
    light: INK,
    dark: BLUSH,
    description: '',
    group: 'primary',
    priority: { fill: 1, text: 2, stroke: 2 },
  },
  {
    id: 'palette.background.paper',
    name: 'background/paper',
    light: WHITE,
    dark: CHARCOAL,
    description: '',
    group: 'background',
    priority: { fill: 0 },
  },
  {
    id: 'palette.primary.contrastText',
    name: 'primary/contrastText',
    light: WHITE,
    dark: CHARCOAL,
    description: '',
    group: 'primary',
    priority: { text: 1 },
  },
  {
    id: 'palette.text.primary',
    name: 'text/primary',
    light: INK,
    dark: WHITE,
    description: '',
    group: 'text',
    priority: { text: 0 },
  },
]

const lit = (color) => ({ light: color, dark: color })

function frame(fill, children = [], dark = false) {
  return {
    type: 'frame',
    path: '',
    name: 'Button',
    box: { x: 0, y: 0, w: 80, h: 32 },
    layout: { mode: 'none' },
    fills: [{ kind: 'solid', color: lit(fill) }],
    stroke: { color: lit(dark ? BLUSH : INK), weights: [1, 1, 1, 1] },
    radius: { values: [11, 11, 11, 11] },
    effects: [],
    clip: false,
    children,
  }
}

function text(color) {
  return {
    type: 'text',
    path: '/0',
    name: 'Label',
    box: { x: 0, y: 0, w: 40, h: 20 },
    text: 'Кнопка',
    style: {
      family: 'Manrope',
      weight: 700,
      sizePx: 13,
      lineHeightPx: 22,
      letterSpacingPx: 0,
      textCase: 'original',
      decoration: 'none',
      align: 'center',
    },
    color: lit(color),
    autoResize: 'both',
  }
}

describe('сведение режимов и токены', () => {
  it('пара совпала в обоих режимах - токен; совпадение в одном режиме не привязывается', () => {
    const index = buildPairIndex(COLORS)
    const report = createMergeReport()
    const merged = mergeTrees(index, report, 'Button', frame(INK, [text(WHITE)]), frame(BLUSH, [text(CHARCOAL)], true))
    expect(merged.fills[0].color).toEqual({ token: 'palette.primary.main' })
    expect(merged.stroke.color).toEqual({ token: 'palette.primary.main' })
    expect(merged.children[0].color).toEqual({ token: 'palette.primary.contrastText' })
    expect(report.unbound.size).toBe(0)

    // Полупрозрачная подложка `alpha(primary.main, 0.08)` - токен с прозрачностью заливки.
    const soft = createMergeReport()
    const faded = mergeTrees(index, soft, 'Button', frame({ ...INK, a: 0.08 }, []), frame({ ...BLUSH, a: 0.08 }, []))
    expect(faded.fills[0].color).toEqual({ token: 'palette.primary.main', opacity: 0.08 })

    const lonely = createMergeReport()
    const half = mergeTrees(index, lonely, 'Button', frame(INK, []), frame(INK, []))
    expect(half.fills[0].color).toEqual({ light: INK, dark: INK })
    expect([...lonely.unbound.values()][0]).toMatchObject({ count: 2 })
  })

  it('роль решает неоднозначность: белый на поверхности - фон для заливки, контрастный текст для текста', () => {
    const index = buildPairIndex(COLORS)
    expect(matchPair(index, WHITE, CHARCOAL, 'fill').token).toBe('palette.background.paper')
    expect(matchPair(index, WHITE, CHARCOAL, 'text').token).toBe('palette.primary.contrastText')
    const report = createMergeReport()
    mergeTrees(index, report, 'Card', frame(WHITE, []), frame(CHARCOAL, []))
    expect([...report.ambiguous.values()][0]).toMatchObject({ chosen: 'palette.background.paper' })
  })

  it('приоритеты и группы берутся из темы: адреса без точек и без схемы MUI', () => {
    const SOFT = { r: 0.96, g: 0.96, b: 0.96, a: 1 }
    const DEEP = { r: 0.15, g: 0.15, b: 0.15, a: 1 }
    const index = buildPairIndex([
      { id: 'muted', name: 'muted', light: SOFT, dark: DEEP, description: '', group: 'muted' },
      {
        id: 'secondary',
        name: 'secondary',
        light: SOFT,
        dark: DEEP,
        description: '',
        group: 'secondary',
        priority: { fill: 0 },
      },
      { id: 'accent', name: 'accent', light: SOFT, dark: DEEP, description: '', group: 'accent' },
    ])
    // Приоритет решает раньше длины адреса; без приоритета - короче адрес, затем по алфавиту.
    expect(matchPair(index, SOFT, DEEP, 'fill')).toMatchObject({ token: 'secondary', group: 'secondary' })
    expect(matchPair(index, SOFT, DEEP, 'text').candidates).toEqual(['muted', 'accent', 'secondary'])
    // При равном приоритете побеждает группа соседа.
    expect(matchPair(index, SOFT, DEEP, 'text', 'accent').token).toBe('accent')
  })

  it('пересчитанный яркостью цвет остаётся литералом, структурное расхождение - в отчёт', () => {
    const index = buildPairIndex(COLORS)
    const report = createMergeReport()
    const hover = frame(INK, [])
    hover.fills[0].color = { ...lit(INK), approx: true }
    const merged = mergeTrees(index, report, 'Button', hover, frame(BLUSH, []))
    expect(merged.fills[0].color).toEqual({ light: INK, dark: BLUSH, approx: true })
    mergeTrees(index, report, 'Chip', frame(INK, [text(WHITE)]), frame(BLUSH, []))
    expect(report.mismatches).toHaveLength(1)
  })

  it('радиусы привязываются к токенам shape, круг - к circle', () => {
    const numbers = [
      { id: 'shape.borderRadiusMd', name: 'radius/md', value: 11, scope: 'radius', description: '' },
      {
        id: 'shape.borderRadiusCircle',
        name: 'radius/circle',
        value: 999,
        scope: 'radius',
        description: '',
        circle: true,
      },
    ]
    const tree = frame(INK, [
      { ...frame(INK), path: '/0', box: { x: 0, y: 0, w: 6, h: 6 }, radius: { values: [3, 3, 3, 3] } },
    ])
    bindRadii(tree, numbers)
    expect(tree.radius.token).toBe('shape.borderRadiusMd')
    expect(tree.children[0].radius.token).toBe('shape.borderRadiusCircle')
    const round = { ...frame(INK), box: { x: 0, y: 0, w: 22, h: 22 }, radius: { values: [11, 11, 11, 11] } }
    bindRadii(round, numbers)
    expect(round.radius.token).toBe('shape.borderRadiusCircle')
  })
})
