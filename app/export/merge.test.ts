import { describe, expect, it } from 'vitest'
import type {
  IColorToken,
  IFrameNode,
  INumberToken,
  IRgba,
  IStroke,
  ITextNode,
  TLayerNode,
  TPaint,
} from './capture/types.ts'
import { buildPairIndex, matchPair } from './colorMatch.ts'
import { bindRadii, createMergeReport, mergeTrees } from './merge.ts'

const INK = { r: 0.251, g: 0.2431, b: 0.2353, a: 1 }
const BLUSH = { r: 0.8902, g: 0.5176, b: 0.4941, a: 1 }
const WHITE = { r: 1, g: 1, b: 1, a: 1 }
const CHARCOAL = { r: 0.102, g: 0.102, b: 0.102, a: 1 }

/** The fixtures' frame: solid fills and a stroke, as `frame()` builds it. */
type TFixtureFrame = IFrameNode & { fills: Extract<TPaint, { kind: 'solid' }>[]; stroke: IStroke }

// Groups and priorities as the MUI adapter sets them (`MUI_COLOR_PRIORITY`): the core does not parse token paths.
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
] satisfies IColorToken[]

const lit = (color: IRgba) => ({ light: color, dark: color })

function frame(fill: IRgba, children: TLayerNode[] = [], dark = false): TFixtureFrame {
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

function text(color: IRgba): ITextNode {
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

describe('merging modes and tokens', () => {
  it('a pair matched in both modes becomes a token; a match in one mode only is not bound', () => {
    const index = buildPairIndex(COLORS)
    const report = createMergeReport()
    const merged = mergeTrees(
      index,
      report,
      'Button',
      frame(INK, [text(WHITE)]),
      frame(BLUSH, [text(CHARCOAL)], true),
    ) as TFixtureFrame & { children: ITextNode[] }
    expect(merged.fills[0].color).toEqual({ token: 'palette.primary.main' })
    expect(merged.stroke.color).toEqual({ token: 'palette.primary.main' })
    expect(merged.children[0].color).toEqual({ token: 'palette.primary.contrastText' })
    expect(report.unbound.size).toBe(0)

    // A translucent backdrop `alpha(primary.main, 0.08)` is a token with fill opacity.
    const soft = createMergeReport()
    const faded = mergeTrees(
      index,
      soft,
      'Button',
      frame({ ...INK, a: 0.08 }, []),
      frame({ ...BLUSH, a: 0.08 }, []),
    ) as TFixtureFrame
    expect(faded.fills[0].color).toEqual({ token: 'palette.primary.main', opacity: 0.08 })

    const lonely = createMergeReport()
    const half = mergeTrees(index, lonely, 'Button', frame(INK, []), frame(INK, [])) as TFixtureFrame
    expect(half.fills[0].color).toEqual({ light: INK, dark: INK })
    expect([...lonely.unbound.values()][0]).toMatchObject({ count: 2 })
  })

  it('the role resolves ambiguity: white on a surface is background for a fill, contrast text for text', () => {
    const index = buildPairIndex(COLORS)
    expect(matchPair(index, WHITE, CHARCOAL, 'fill')!.token).toBe('palette.background.paper')
    expect(matchPair(index, WHITE, CHARCOAL, 'text')!.token).toBe('palette.primary.contrastText')
    const report = createMergeReport()
    mergeTrees(index, report, 'Card', frame(WHITE, []), frame(CHARCOAL, []))
    expect([...report.ambiguous.values()][0]).toMatchObject({ chosen: 'palette.background.paper' })
  })

  it('priorities and groups come from the theme: token paths without dots and without the MUI scheme', () => {
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
    // Priority decides before path length; without a priority, the shorter path wins, then alphabetical order.
    expect(matchPair(index, SOFT, DEEP, 'fill')).toMatchObject({ token: 'secondary', group: 'secondary' })
    expect(matchPair(index, SOFT, DEEP, 'text')!.candidates).toEqual(['muted', 'accent', 'secondary'])
    // With equal priority the neighbor's group wins.
    expect(matchPair(index, SOFT, DEEP, 'text', 'accent')!.token).toBe('accent')
  })

  it('a color recomputed by brightness stays a literal, a structure mismatch goes to the report', () => {
    const index = buildPairIndex(COLORS)
    const report = createMergeReport()
    const hover = frame(INK, [])
    hover.fills[0].color = { ...lit(INK), approx: true }
    const merged = mergeTrees(index, report, 'Button', hover, frame(BLUSH, [])) as TFixtureFrame
    expect(merged.fills[0].color).toEqual({ light: INK, dark: BLUSH, approx: true })
    mergeTrees(index, report, 'Chip', frame(INK, [text(WHITE)]), frame(BLUSH, []))
    expect(report.mismatches).toHaveLength(1)
  })

  it('radii are bound to shape tokens, a circle to circle', () => {
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
    ] satisfies INumberToken[]
    const tree = frame(INK, [
      { ...frame(INK), path: '/0', box: { x: 0, y: 0, w: 6, h: 6 }, radius: { values: [3, 3, 3, 3] } },
    ])
    bindRadii(tree, numbers)
    expect(tree.radius.token).toBe('shape.borderRadiusMd')
    expect((tree.children[0] as IFrameNode).radius.token).toBe('shape.borderRadiusCircle')
    const round: IFrameNode = { ...frame(INK), box: { x: 0, y: 0, w: 22, h: 22 }, radius: { values: [11, 11, 11, 11] } }
    bindRadii(round, numbers)
    expect(round.radius.token).toBe('shape.borderRadiusCircle')
  })
})
