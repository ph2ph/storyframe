import { describe, expect, it } from 'vitest'
import type { IFrameNode, ITextNode, TLayerNode } from './capture/types.ts'
import { SCHEMA_VERSION, emptyBundle, validateBundle } from './schema.ts'

const RGBA = { r: 0.25, g: 0.24, b: 0.23, a: 1 }

function frame(children: TLayerNode[] = []): IFrameNode {
  return {
    type: 'frame',
    path: '',
    name: 'Button',
    box: { x: 0, y: 0, w: 76, h: 32 },
    layout: { mode: 'row', gap: 8, padding: [0, 15, 0, 15], justify: 'center', align: 'center', wrap: false },
    fills: [{ kind: 'solid', color: { token: 'palette.primary.main' } }],
    radius: { values: [11, 11, 11, 11], token: 'shape.borderRadiusMd' },
    effects: [],
    clip: false,
    children,
  }
}

function text(): ITextNode {
  return {
    type: 'text',
    path: '0',
    name: 'Label',
    box: { x: 15, y: 5, w: 46, h: 22 },
    text: 'Button',
    style: {
      family: 'Manrope',
      weight: 700,
      sizePx: 12.96,
      lineHeightPx: 22.68,
      letterSpacingPx: 0.4,
      textCase: 'original',
      decoration: 'none',
      align: 'center',
    },
    color: { light: RGBA, dark: RGBA },
    autoResize: 'both',
  }
}

describe('export schema', () => {
  it('accepts an empty export and an export with a component', () => {
    expect(validateBundle(emptyBundle('0.12.0'))).toEqual([])
    const bundle = emptyBundle('0.12.0')
    bundle.tokens.colors.push({
      id: 'palette.primary.main',
      name: 'primary/main',
      light: RGBA,
      dark: RGBA,
      description: '',
    })
    bundle.components.push({
      id: 'Button',
      name: 'Inputs/Button',
      description: '',
      storyUrl: '',
      axes: [{ name: 'Variant', values: ['contained'] }],
      textProps: [{ name: 'Label', path: '0' }],
      variants: [{ variant: { Variant: 'contained' }, tree: frame([text()]), signature: ['MuiButton-root'] }],
      dependsOn: [],
    })
    bundle.stories.push({ id: 'button--colors', name: 'Colors', storyUrl: '', tree: frame([text()]) })
    bundle.pages.push({
      id: 'components',
      name: 'Components',
      sections: [
        {
          id: 'components:Inputs',
          title: 'Inputs',
          items: [
            {
              id: 'Components/Inputs/Button',
              title: 'Button',
              description: '',
              storyUrl: '',
              component: 'Button',
              stories: ['button--colors'],
            },
          ],
        },
      ],
    })
    expect(validateBundle(bundle)).toEqual([])
  })

  it('names the field with the error', () => {
    const bundle = emptyBundle()
    bundle.schema = SCHEMA_VERSION + 1
    const issues = validateBundle(bundle)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatch(/^schema: /)

    const withNode = emptyBundle()
    // A node the schema must reject: outside the node type on purpose.
    const tree = frame([{ ...text(), autoResize: 'wrong' } as unknown as ITextNode])
    withNode.stories.push({ id: 'card', name: 'Card', storyUrl: '', tree })
    expect(validateBundle(withNode).join('\n')).toContain('stories.0.tree.children.0.autoResize')
  })

  it('layout is optional; folder width is a number of at least 320', () => {
    const bundle = emptyBundle()
    bundle.layout = { maxWidth: 1980 }
    expect(validateBundle(bundle)).toEqual([])
    bundle.layout = { maxWidth: 100 }
    expect(validateBundle(bundle).join('\n')).toContain('layout.maxWidth')
  })
})
