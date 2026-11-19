import { describe, expect, it } from 'vitest'
import type { IBox, IFrameNode, ITextNode, ITextStyleValues, TColorRef, TLayerNode } from './capture/types.ts'
import { buildSignatureIndex, matchSignature, replaceInstances, type ISignatureComponent } from './signatures.ts'

function frame(
  classes: string[],
  children: TLayerNode[] = [],
  path = '',
  box: IBox = { x: 0, y: 0, w: 10, h: 10 },
): IFrameNode {
  return {
    type: 'frame',
    path,
    name: 'div',
    box,
    layout: { mode: 'none' },
    fills: [],
    radius: { values: [0, 0, 0, 0] },
    effects: [],
    clip: false,
    children,
    classes,
  }
}
const text = (value: string, path: string, h = 1): ITextNode => ({
  type: 'text',
  path,
  name: 'Label',
  box: { x: 0, y: 0, w: 1, h },
  text: value,
  style: {} as ITextStyleValues,
  color: {} as TColorRef,
  autoResize: 'both',
})

const BUTTON = (variant: string, state: string, extra: string[] = []) => ({
  variant: { Variant: variant, State: state },
  signature: ['MuiButton-root', 'MuiButtonBase-root', `MuiButton-${variant}`, 'MuiButton-sizeMedium', ...extra].sort(),
  tree: frame([], [text('Button', '/0')]),
})

const COMPONENTS = [
  {
    id: 'Button',
    textProps: [{ name: 'Label', path: '/0' }],
    variants: [
      BUTTON('contained', 'default'),
      BUTTON('contained', 'hover'),
      BUTTON('contained', 'disabled', ['Mui-disabled']),
      BUTTON('text', 'default'),
    ],
  },
  {
    id: 'Chip',
    textProps: [],
    variants: [{ variant: { Variant: 'tone' }, signature: ['MuiChip-root', 'MuiChip-tone'], tree: frame([]) }],
  },
] satisfies ISignatureComponent[]

describe('class signatures', () => {
  it('the longest signature wins, on a tie the variant without a state', () => {
    const index = buildSignatureIndex(COMPONENTS)
    const classes = [
      'MuiButtonBase-root',
      'MuiButton-root',
      'MuiButton-contained',
      'MuiButton-sizeMedium',
      'MuiButton-colorPrimary',
      'css-x',
    ]
    expect(matchSignature(index, classes).entry!.variant).toEqual({ Variant: 'contained', State: 'default' })
    expect(matchSignature(index, [...classes, 'Mui-disabled']).entry!.variant.State).toBe('disabled')
    expect(matchSignature(index, ['MuiButton-root', 'MuiButton-outlined']).entry).toBeNull()
    expect(matchSignature(index, ['MuiButton-root', 'MuiButton-outlined']).component).toBe('Button')
    expect(matchSignature(index, ['MuiBox-root']).component).toBeNull()
    expect(matchSignature(index, classes, 'Button').entry).toBeNull()
  })

  it('pattern nodes become instances with a label, combinations outside the matrix go to the report', () => {
    const index = buildSignatureIndex(COMPONENTS)
    const tree = frame(
      ['MuiCard-root'],
      [
        frame(
          ['MuiButtonBase-root', 'MuiButton-root', 'MuiButton-contained', 'MuiButton-sizeMedium'],
          [text('Run', '/0/0')],
          '/0',
        ),
        frame(['MuiButton-root', 'MuiButton-outlined'], [text('More', '/1/0')], '/1'),
      ],
    )
    const { tree: result, dependsOn, outOfMatrix } = replaceInstances(tree, index, { where: 'Card' })
    expect((result as IFrameNode).children[0]).toMatchObject({
      type: 'instance',
      component: 'Button',
      variant: { Variant: 'contained', State: 'default' },
      overrides: { text: { Label: 'Run' } },
    })
    expect((result as IFrameNode).children[1].type).toBe('frame')
    expect((result as IFrameNode).children[1].classes).toBeUndefined()
    expect(dependsOn).toEqual(['Button'])
    expect(outOfMatrix).toEqual(['Card /1: Button (MuiButton-root MuiButton-outlined)'])
  })

  it('a node differing from the variant not by the label stays as layers with the reason', () => {
    const index = buildSignatureIndex(COMPONENTS)
    const button = ['MuiButtonBase-root', 'MuiButton-root', 'MuiButton-contained', 'MuiButton-sizeMedium']
    const tree = frame(
      ['MuiCard-root'],
      [
        frame(button, [text('Save', '/0/0')], '/0', { x: 0, y: 0, w: 40, h: 10 }),
        frame(button, [text('Two lines', '/1/0', 3)], '/1'),
        frame(button, [text('Cancel', '/2/0')], '/2'),
      ],
    )
    const { tree: result, kept } = replaceInstances(tree, index, { where: 'Form' })
    expect((result as IFrameNode).children.map((child) => child.type)).toEqual(['frame', 'frame', 'instance'])
    expect(kept).toEqual(['Form /0: Button - /: width 40×10 ≠ 10×10', 'Form /1: Button - /0: text height 1×3 ≠ 1×1'])
  })

  it('a merged twin of a variant is found by its signature and yields an instance of the remaining variant', () => {
    const merged: ISignatureComponent = {
      id: 'Bar',
      textProps: [],
      variants: [
        {
          variant: { Color: 'primary' },
          signature: ['MuiAppBar-root', 'MuiAppBar-positionFixed'],
          tree: frame([]),
          aliases: [{ signature: ['MuiAppBar-root', 'MuiAppBar-positionStatic'], tree: frame([]) }],
        },
      ],
    }
    const index = buildSignatureIndex([merged])
    const { entry } = matchSignature(index, ['MuiAppBar-root', 'MuiAppBar-positionStatic'])
    expect(entry?.component).toBe('Bar')
    expect(entry?.variant).toEqual({ Color: 'primary' })
  })
})
