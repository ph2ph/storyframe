import { describe, expect, it } from 'vitest'
import { docsMatrices } from './docsMatrix.ts'

const select = (options: string[]) => ({ options, control: { type: 'select' } })
const flag = { control: { type: 'boolean' } }

const BUTTON = {
  id: 'mui-inputs-button--basic',
  argTypes: {
    variant: select(['contained', 'outlined']),
    color: select(['inherit', 'primary', 'error']),
    size: select(['small', 'medium']),
    disabled: flag,
    fullWidth: flag,
    children: { control: { type: 'text' } },
  },
}

const CONFIG = {
  pages: [{ id: 'components', name: 'Компоненты', include: ['Компоненты', 'Компоненты MUI'] }],
  exclude: ['Компоненты MUI/Utils'],
  skip: { Modal: 'портал' },
  components: [
    {
      id: 'TextField',
      name: 'Inputs/TextField',
      storyId: 'mui-inputs-textfield--basic',
      root: '.MuiTextField-root',
      axes: [{ name: 'Variant', arg: 'variant' }],
      states: ['default', 'hover', 'focus'],
      stateArgs: { focus: { focused: true } },
    },
  ],
}

describe('variant matrix for the docs', () => {
  it('discovered set: axes from argTypes without inherit, state flags and modifiers, states from flags', () => {
    const [matrix] = docsMatrices('Компоненты MUI/Inputs/Button', [BUTTON], CONFIG)
    expect(matrix.axes!.map((axis) => [axis.name, axis.values])).toEqual([
      ['Variant', ['contained', 'outlined']],
      ['Color', ['primary', 'error']],
      ['Size', ['small', 'medium']],
      ['State', ['default', 'hover', 'disabled']],
    ])
    expect(matrix.count).toBe(2 * 2 * 2 * 3)
    // Columns are the two minor axes, as in Figma; rows are the rest.
    expect(matrix.columns!.map((column) => column.key)).toEqual([
      'small|default',
      'small|hover',
      'small|disabled',
      'medium|default',
      'medium|hover',
      'medium|disabled',
    ])
    expect(matrix.rows!.map((row) => row.key)).toEqual([
      'contained|primary',
      'contained|error',
      'outlined|primary',
      'outlined|error',
    ])
    const [, hover, disabled] = matrix.rows![0].cells
    expect(hover).toMatchObject({
      args: { variant: 'contained', color: 'primary', size: 'small' },
      pseudo: ['pseudo-hover-all'],
    })
    expect(disabled).toMatchObject({ args: { disabled: true }, pseudo: [] })
  })

  it('the configuration entry takes precedence: focus takes the entry args, not the focus classes', () => {
    const story = { id: 'mui-inputs-textfield--basic', argTypes: { variant: select(['outlined', 'filled']) } }
    const [matrix] = docsMatrices('Компоненты MUI/Inputs/TextField', [story], CONFIG)
    expect(matrix.id).toBe('TextField')
    const focus = matrix.rows!.flatMap((row) => row.cells).find((cell) => cell?.variant.State === 'focus')
    expect(focus).toMatchObject({ args: { variant: 'outlined', focused: true }, pseudo: [] })

    const { stateArgs, ...plain } = CONFIG.components[0]
    void stateArgs
    const [bare] = docsMatrices('Компоненты MUI/Inputs/TextField', [story], { ...CONFIG, components: [plain] })
    expect(bare.rows!.flatMap((row) => row.cells).find((cell) => cell?.variant.State === 'focus')?.pseudo).toEqual([
      'pseudo-focus-all',
      'pseudo-focus-visible-all',
      'pseudo-focus-within-all',
    ])
  })

  it('a skipped title, an excluded one and one that landed on no page yield no matrices', () => {
    expect(docsMatrices('Компоненты MUI/Feedback/Modal', [BUTTON], CONFIG)).toEqual([])
    expect(docsMatrices('Компоненты MUI/Utils/Popper', [BUTTON], CONFIG)).toEqual([])
    expect(docsMatrices('MCP/Подключение', [BUTTON], CONFIG)).toEqual([])
  })

  it('an axis without a list of values in argTypes is a matrix error, not an exception', () => {
    const story = { id: 'mui-inputs-textfield--basic', argTypes: {} }
    const [matrix] = docsMatrices('Компоненты MUI/Inputs/TextField', [story], CONFIG)
    expect(matrix.error).toContain('variant')
  })
})
