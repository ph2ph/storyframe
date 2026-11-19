import { describe, expect, it } from 'vitest'
import type { IFrameNode, ITextStyleValues } from './capture/types.ts'
import { collapseIdentical, sameLook, type IDedupeComponent } from './dedupe.ts'

function tree(width: number, { color = 'palette.primary.main', textX = 16 } = {}): IFrameNode {
  return {
    type: 'frame',
    path: '',
    name: 'Bar',
    box: { x: 0, y: 0, w: width, h: 64 },
    layout: { mode: 'none' },
    fills: [{ kind: 'solid', color: { token: color } }],
    radius: { values: [0, 0, 0, 0] },
    effects: [],
    clip: false,
    children: [
      {
        type: 'text',
        path: '/0',
        name: 'Label',
        box: { x: textX, y: 20, w: 80, h: 24 },
        text: 'Header',
        // Only the fields the comparison needs: the fixture style is partial.
        style: { family: 'Manrope', weight: 700, sizePx: 16, lineHeightPx: 24 } as ITextStyleValues,
        color: { token: 'palette.text.primary' },
        autoResize: 'both',
      },
    ],
  }
}

describe('merging of indistinguishable variants', () => {
  it('compares appearance without names and paths; different root width means no horizontal geometry', () => {
    expect(sameLook(tree(1200), { ...tree(1200), name: 'Other', path: '/x' })).toBe(true)
    expect(sameLook(tree(1280), tree(1200, { textX: 20 }))).toBe(true)
    expect(sameLook(tree(1200), tree(1200, { textX: 20 }))).toBe(false)
    expect(sameLook(tree(1280), tree(1200, { color: 'palette.error.main' }))).toBe(false)
  })

  it('merges values indistinguishable from the default value and remembers the twins', () => {
    const variant = (position: string, color: string, width: number) => ({
      variant: { Position: position, Color: color },
      tree: tree(width, { color: `palette.${color}.main` }),
      signature: ['MuiAppBar-root', `MuiAppBar-position${position}`],
      stretched: true,
    })
    const component: IDedupeComponent = {
      axes: [
        { name: 'Position', values: ['fixed', 'static', 'sticky'], description: 'Positioning' },
        { name: 'Color', values: ['primary', 'error'] },
      ],
      variants: [
        variant('fixed', 'primary', 1280),
        variant('fixed', 'error', 1280),
        variant('static', 'primary', 1200),
        variant('static', 'error', 1200),
        variant('sticky', 'primary', 1200),
        variant('sticky', 'error', 1200),
      ],
    }
    const collapsed = collapseIdentical(component, { Position: 'fixed', Color: 'primary' })
    expect(collapsed).toEqual([
      { axis: 'Position', values: ['static', 'sticky'], into: 'fixed', description: 'Positioning' },
    ])
    expect(component.axes.map((axis) => axis.name)).toEqual(['Color'])
    expect(component.variants.map((entry) => entry.variant)).toEqual([{ Color: 'primary' }, { Color: 'error' }])
    expect(component.variants[0].aliases!.map((alias) => alias.signature[1])).toEqual([
      'MuiAppBar-positionstatic',
      'MuiAppBar-positionsticky',
    ])
  })

  it('roots whose width the component itself set (Container with maxWidth) are compared with their width', () => {
    const component = {
      axes: [{ name: 'MaxWidth', values: ['sm', 'lg'] }],
      variants: [
        { variant: { MaxWidth: 'sm' }, tree: tree(600), signature: [], stretched: false },
        { variant: { MaxWidth: 'lg' }, tree: tree(1200), signature: [], stretched: true },
      ],
    }
    expect(collapseIdentical(component, { MaxWidth: 'sm' })).toEqual([])
    expect(component.variants).toHaveLength(2)
  })

  it('if all axes were merged, State stays: Figma needs at least one', () => {
    const component = {
      axes: [
        { name: 'CenterRipple', values: ['false', 'true'] },
        { name: 'State', values: ['default', 'hover'] },
      ],
      variants: ['false', 'true'].flatMap((ripple) =>
        ['default', 'hover'].map((state) => ({
          variant: { CenterRipple: ripple, State: state },
          tree: tree(200),
          signature: [],
        })),
      ),
    }
    collapseIdentical(component, { CenterRipple: 'false', State: 'default' })
    expect(component.axes).toEqual([{ name: 'State', values: ['default'] }])
    expect(component.variants.map((entry) => entry.variant)).toEqual([{ State: 'default' }])
  })
})
