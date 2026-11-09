import { describe, expect, it } from 'vitest'
import { absorbOffsets, flexLayout, gapsVary, uniformGap, unstretched, wrapGaps } from './layout.ts'
import type { TLayout } from './types.ts'

const flow = (
  mode: 'row' | 'column',
  padding: [number, number, number, number],
  justify: 'min' | 'center',
  align: 'min' | 'center' | 'stretch',
): TLayout => ({
  mode,
  gap: 0,
  padding,
  justify,
  align,
  wrap: false,
})

const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h })
const style = (overrides: Record<string, string>) =>
  ({
    flexDirection: 'column',
    flexWrap: 'nowrap',
    columnGap: '0px',
    rowGap: '0px',
    paddingTop: '0px',
    paddingRight: '0px',
    paddingBottom: '0px',
    paddingLeft: '0px',
    borderTopWidth: '0px',
    borderRightWidth: '0px',
    borderBottomWidth: '0px',
    borderLeftWidth: '0px',
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    ...overrides,
  }) as unknown as CSSStyleDeclaration

describe('layout gaps', () => {
  it('equal gaps give a gap, a deviation of up to 1 px is tolerated', () => {
    expect(uniformGap([box(0, 0, 10, 10), box(0, 18, 10, 10), box(0, 36.8, 10, 10)], false)).toBe(8)
    expect(gapsVary([box(0, 0, 10, 10), box(0, 18, 10, 10)], false)).toBe(false)
  })

  it('differing gaps (margins on children) leave the container without a layout', () => {
    const boxes = [box(0, 0, 100, 19), box(0, 50, 100, 44), box(0, 122, 100, 63), box(0, 213, 100, 45)]
    expect(gapsVary(boxes, false)).toBe(true)
    expect(flexLayout(style({}), boxes)).toEqual({ mode: 'none' })
  })

  it('a wrapping row does not measure gaps and is marked wrap', () => {
    const layout = flexLayout(style({ flexDirection: 'row', flexWrap: 'wrap', columnGap: '16px' }), [
      box(0, 0, 200, 40),
      box(216, 0, 200, 40),
      box(0, 56, 200, 40),
    ])
    expect(layout).toMatchObject({ mode: 'row', gap: 16, wrap: true })
  })

  it('a wrapping row filled edge to edge is exported without wrapping', () => {
    // DataTable toolbar filters: two fields and a checkbox filling the row width edge to edge.
    const layout = flexLayout(
      style({ flexDirection: 'row', flexWrap: 'wrap', columnGap: '16px', rowGap: '16px' }),
      [box(0, 0, 170, 50.41), box(186, 0, 150, 50.41), box(352, 19.41, 140.47, 31)],
      box(0, 0, 492.47, 50.41),
    )
    expect(layout).toEqual({
      mode: 'row',
      gap: 16,
      padding: [0, 0, 0, 0],
      justify: 'min',
      align: 'stretch',
      wrap: false,
    })
  })

  it('a wrapping row with free space keeps wrapping, even on a single line', () => {
    // DataTable toolbar: filters on the left, actions on the right, free space of the table width between them.
    const layout = flexLayout(
      style({
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        columnGap: '16px',
        rowGap: '16px',
      }),
      [box(0, 0, 492.47, 50.41), box(938.38, 8.2, 261.63, 34)],
      box(0, 0, 1200, 50.41),
    )
    expect(layout).toMatchObject({ mode: 'row', justify: 'space-between', wrap: true, crossGap: 16 })
  })

  it('the first child margin goes into padding, an asymmetric center goes to the start', () => {
    const chip = absorbOffsets(flow('row', [4, 6, 4, 6], 'center', 'center'), [box(11, 10, 6, 6), box(17, 4, 35, 18)], {
      w: 58,
      h: 26,
    })
    expect(chip).toMatchObject({ justify: 'min', padding: [4, 6, 4, 11] })
    expect(
      absorbOffsets(flow('column', [1, 1, 1, 1], 'min', 'min'), [box(23, 19, 274, 74)], { w: 320, h: 112 }),
    ).toMatchObject({
      padding: [19, 1, 1, 23],
    })
  })

  it('differing cross-axis offsets of children leave the container without a layout', () => {
    expect(
      absorbOffsets(flow('column', [0, 0, 0, 0], 'min', 'min'), [box(0, 0, 100, 34), box(9, 34, 90, 20)], {
        w: 100,
        h: 54,
      }),
    ).toEqual({ mode: 'none' })
  })

  it('content not fitting the CSS padding sets padding by geometry; beyond the box edge, no layout', () => {
    // Vertical fullWidth tab: a 24 px box with 12 + 12 padding, the 19 px text spills into the padding.
    const squeezed = absorbOffsets(flow('row', [12, 14, 12, 14], 'min', 'center'), [box(14, 2.25, 51, 19)], {
      w: 1183,
      h: 24,
    })
    expect(squeezed).toMatchObject({ mode: 'row', padding: [2.25, 14, 2.75, 14] })
    expect(absorbOffsets(flow('row', [0, 0, 0, 0], 'min', 'min'), [box(-41, 0, 10, 10)], { w: 100, h: 10 })).toEqual({
      mode: 'none',
    })
  })

  it('a wrapping row measures the gap within a line and between lines by geometry (Stack with margins)', () => {
    const boxes = [box(0, 0, 56, 80), box(68, 0, 56, 80), box(136, 0, 56, 80), box(0, 100, 56, 80)]
    expect(wrapGaps(boxes, true)).toEqual({ main: 12, cross: 20 })
    expect(
      flexLayout(style({ flexDirection: 'row', flexWrap: 'wrap', columnGap: '0px', rowGap: '0px' }), boxes),
    ).toMatchObject({ mode: 'row', gap: 12, crossGap: 20, wrap: true })
  })

  it('stretch does not pull a child with its own cross-axis size (a 22×22 icon in the Alert column)', () => {
    const icon = flow('row', [7, 0, 7, 0], 'min', 'stretch')
    expect(unstretched(icon, [box(0, 7, 22, 22)], { w: 22, h: 60 })).toEqual([true])
    expect(unstretched(icon, [box(0, 7, 22, 46)], { w: 22, h: 60 })).toEqual([false])
    expect(unstretched(flow('row', [0, 0, 0, 0], 'min', 'center'), [box(0, 0, 22, 22)], { w: 22, h: 60 })).toEqual([
      false,
    ])
  })

  it('a wrapping row with differing gaps in a line is left without a layout, not squeezed to the CSS gap', () => {
    const boxes = [box(0, 0, 58, 17), box(100, 0, 80, 32), box(192, 0, 80, 32)]
    expect(
      flexLayout(style({ flexDirection: 'row', flexWrap: 'wrap', columnGap: '0px', rowGap: '0px' }), boxes),
    ).toEqual({ mode: 'none' })
  })
})
