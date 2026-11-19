import { describe, expect, it } from 'vitest'
import {
  autoAxes,
  autoStates,
  defaultValue,
  failedVariant,
  findRootSelector,
  pickStory,
  resolveAutoEntry,
  withoutValue,
} from './discover.ts'

/** The part of a DOM element `findRootSelector` reads. */
type TFakeElement = { classList: string[]; children: TFakeElement[] }

const INDEX = [
  {
    type: 'story',
    id: 'components-mui-inputs-fab--basic',
    title: 'Components MUI/Inputs/Fab',
    importPath: './src/a.tsx',
  },
  {
    type: 'story',
    id: 'components-mui-inputs-fab--colors',
    title: 'Components MUI/Inputs/Fab',
    importPath: './src/a.tsx',
  },
  {
    type: 'story',
    id: 'components-mui-inputs-button--basic',
    title: 'Components MUI/Inputs/Button',
    importPath: './src/b.tsx',
  },
  {
    type: 'story',
    id: 'components-mui-utils-modal--basic',
    title: 'Components MUI/Utils/Modal',
    importPath: './src/m.tsx',
  },
  { type: 'story', id: 'components-datatable--collapsed', title: 'Components/DataTable', importPath: './src/d.tsx' },
  { type: 'story', id: 'components-datatable--expanded', title: 'Components/DataTable', importPath: './src/d.tsx' },
  {
    type: 'docs',
    id: 'components-mui-inputs-fab--docs',
    title: 'Components MUI/Inputs/Fab',
    importPath: './src/a.tsx',
  },
  { type: 'story', id: 'guideline-colors--basic', title: 'Guideline/Colors', importPath: './src/g.tsx' },
]

describe('discovery of catalog components', () => {
  it('the "Basic" story of an item is `--basic`, otherwise the first one', () => {
    const fab = INDEX.filter((entry) => entry.type === 'story' && entry.title === 'Components MUI/Inputs/Fab')
    expect(pickStory(fab).id).toBe('components-mui-inputs-fab--basic')
    const table = INDEX.filter((entry) => entry.title === 'Components/DataTable')
    expect(pickStory(table).id).toBe('components-datatable--collapsed')
  })

  it('axes from argTypes: lists without inherit, flags without states and modifiers', () => {
    const argTypes = {
      color: { control: 'select', options: ['inherit', 'primary', 'secondary'] },
      size: { control: 'select', options: ['small'] },
      selected: { control: 'boolean' },
      disabled: { control: 'boolean' },
      fullWidth: { control: 'boolean' },
      disableRipple: { control: 'boolean' },
      children: { control: 'text', options: null },
    }
    expect(autoAxes(argTypes).map((axis) => axis.name)).toEqual(['Color', 'Selected'])
    expect(autoStates(argTypes)).toEqual(['default', 'hover', 'disabled'])
    expect(autoStates({ error: { control: 'boolean' } })).toEqual(['default', 'error'])
  })

  it('matrix limit: flags are dropped first, then lists from the end', () => {
    const argTypes = {
      color: { control: 'select', options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] },
      size: { control: 'select', options: ['s', 'm', 'l'] },
      variant: { control: 'select', options: ['x', 'y'] },
      square: { control: 'boolean' },
      disabled: { control: 'boolean' },
      children: { control: 'text' },
    }
    const entry = resolveAutoEntry({ id: 'Fab', auto: true }, argTypes, 64)
    expect(entry.axes.map((axis) => axis.name)).toEqual(['Color', 'Size'])
    expect(entry.dropped).toEqual(['Square', 'Variant'])
    expect(entry.states).toEqual(['default', 'hover', 'disabled'])
    expect(entry.label).toBe(true)
    expect(entry.axes[0]).toEqual({ name: 'Color', arg: 'color', exclude: ['inherit'] })
  })

  it('the story root is the first element with a "Prefix+Name-root" class, otherwise the fallback selector', () => {
    const element = (classes: string[], children: TFakeElement[] = []): TFakeElement => ({
      classList: classes,
      children,
    })
    const all: TFakeElement[] = []
    const walk = (node: TFakeElement) => {
      all.push(node)
      node.children.forEach(walk)
    }
    const tree = element(
      ['wrapper'],
      [element(['MuiOutlinedInput-root'], [element(['MuiInput-root'])]), element(['MuiIconButton-root'])],
    )
    walk(tree)
    // Only the members the function touches: the fake stands in for the tab's window.
    const win = { document: { querySelector: () => ({ querySelectorAll: () => all }), body: {} } } as unknown as Window
    expect(findRootSelector(win, 'Input', '#root > *')).toBe('.MuiInput-root')
    expect(findRootSelector(win, 'Button', '#root > *')).toBe('#root > *')
  })
})

describe('excluding the value on which the story fails', () => {
  const entry = {
    id: 'Select',
    auto: true,
    states: ['default', 'hover', 'disabled'],
    axes: [
      { name: 'Variant', arg: 'variant', exclude: ['inherit'] },
      { name: 'Multiple', values: { false: { multiple: false }, true: { multiple: true } } },
    ],
  }

  it('parses the variant from the error message and finds the axis defaults', () => {
    const message =
      'components-mui-inputs-select--basic Variant=standard, Multiple=true, State=default (light): Error: #2'
    expect(failedVariant(message)).toEqual({ Variant: 'standard', Multiple: 'true', State: 'default' })
    expect(failedVariant('something else')).toBeNull()
    const initialArgs = { variant: 'outlined', multiple: false }
    expect(defaultValue(entry, 'Variant', initialArgs)).toBe('outlined')
    expect(defaultValue(entry, 'Multiple', initialArgs)).toBe('false')
    expect(defaultValue(entry, 'State', initialArgs)).toBe('default')
  })

  it('removes a flag value (an axis with a single value disappears), a list value and a state', () => {
    expect(withoutValue(entry, 'Multiple', 'true')?.axes.map((axis) => axis.name)).toEqual(['Variant'])
    expect(withoutValue(entry, 'Variant', 'standard')?.axes[0].exclude).toEqual(['inherit', 'standard'])
    expect(withoutValue(entry, 'State', 'disabled')?.states).toEqual(['default', 'hover'])
    expect(withoutValue(entry, 'Size', 'small')).toBeNull()
  })
})
