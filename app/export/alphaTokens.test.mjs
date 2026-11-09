import { describe, expect, it } from 'vitest'
import { deriveAlphaTokens } from './alphaTokens.mjs'

const base = {
  id: 'palette.primary.main',
  name: 'primary/main',
  light: { r: 0.25, g: 0.24, b: 0.23, a: 1 },
  dark: { r: 0.89, g: 0.52, b: 0.49, a: 1 },
  description: '',
  code: 'theme.palette.primary.main',
}

function bundle() {
  return {
    tokens: { colors: [{ ...base }] },
    components: [
      {
        variants: [
          {
            tree: {
              type: 'frame',
              fills: [
                { kind: 'solid', color: { token: 'palette.primary.main', opacity: 0.08 } },
                { kind: 'solid', color: { token: 'palette.primary.main', opacity: 0 } },
              ],
              stroke: { color: { token: 'palette.primary.main', opacity: 0.5 }, weights: [1, 1, 1, 1] },
              effects: [
                {
                  type: 'drop',
                  color: { token: 'palette.primary.main', opacity: 0.35 },
                  offset: { x: 0, y: 0 },
                  blur: 3,
                  spread: 0,
                },
                { type: 'backgroundBlur', radius: 3 },
              ],
              children: [
                { type: 'text', color: { token: 'palette.primary.main', opacity: 1 } },
                { type: 'svg', color: { light: { r: 0, g: 0, b: 0, a: 1 }, dark: { r: 1, g: 1, b: 1, a: 1 } } },
              ],
            },
          },
        ],
      },
    ],
    stories: [
      {
        tree: {
          type: 'frame',
          fills: [],
          stroke: { color: { token: 'palette.primary.main', opacity: 0 }, weights: [0, 0, 1, 0] },
          effects: [],
          children: [],
        },
      },
    ],
  }
}

describe('deriveAlphaTokens', () => {
  it('creates an alpha token for every "token + opacity" pair and removes transparent fills', () => {
    const data = bundle()
    const added = deriveAlphaTokens(data)
    expect(added.map((token) => token.name)).toEqual(['primary/main-08', 'primary/main-35', 'primary/main-50'])
    expect(added[0]).toMatchObject({ id: 'palette.primary.main@0.08', light: { a: 0.08 }, dark: { a: 0.08 } })
    expect(added[0].description).toContain('alpha(theme.palette.primary.main, 0.08)')
    // The derived token takes the code hint from the base token, and the text color flag as well.
    expect(added[0].code).toBe('theme.palette.primary.main@0.08')
    expect(added[0]).not.toHaveProperty('text')
    const tree = data.components[0].variants[0].tree
    expect(tree.fills).toEqual([{ kind: 'solid', color: { token: 'palette.primary.main@0.08' } }])
    expect(tree.stroke.color).toEqual({ token: 'palette.primary.main@0.5' })
    expect(tree.effects[0].color).toEqual({ token: 'palette.primary.main@0.35' })
    expect(tree.children[0].color).toEqual({ token: 'palette.primary.main' })
    expect(data.stories[0].tree.stroke).toBeUndefined()
    expect(data.tokens.colors).toHaveLength(4)
    expect(deriveAlphaTokens(data)).toEqual([])
  })
})
