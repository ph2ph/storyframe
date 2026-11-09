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
} from './discover.mjs'

const INDEX = [
  {
    type: 'story',
    id: 'компоненты-mui-inputs-fab--basic',
    title: 'Компоненты MUI/Inputs/Fab',
    importPath: './src/a.tsx',
  },
  {
    type: 'story',
    id: 'компоненты-mui-inputs-fab--colors',
    title: 'Компоненты MUI/Inputs/Fab',
    importPath: './src/a.tsx',
  },
  {
    type: 'story',
    id: 'компоненты-mui-inputs-button--basic',
    title: 'Компоненты MUI/Inputs/Button',
    importPath: './src/b.tsx',
  },
  {
    type: 'story',
    id: 'компоненты-mui-utils-modal--basic',
    title: 'Компоненты MUI/Utils/Modal',
    importPath: './src/m.tsx',
  },
  { type: 'story', id: 'компоненты-datatable--collapsed', title: 'Компоненты/DataTable', importPath: './src/d.tsx' },
  { type: 'story', id: 'компоненты-datatable--expanded', title: 'Компоненты/DataTable', importPath: './src/d.tsx' },
  {
    type: 'docs',
    id: 'компоненты-mui-inputs-fab--docs',
    title: 'Компоненты MUI/Inputs/Fab',
    importPath: './src/a.tsx',
  },
  { type: 'story', id: 'гайдлайн-цвета--basic', title: 'Гайдлайн/Цвета', importPath: './src/g.tsx' },
]

describe('обнаружение компонентов каталога', () => {
  it('«Базовая» история пункта - `--basic`, иначе первая', () => {
    const fab = INDEX.filter((entry) => entry.type === 'story' && entry.title === 'Компоненты MUI/Inputs/Fab')
    expect(pickStory(fab).id).toBe('компоненты-mui-inputs-fab--basic')
    const table = INDEX.filter((entry) => entry.title === 'Компоненты/DataTable')
    expect(pickStory(table).id).toBe('компоненты-datatable--collapsed')
  })

  it('оси из argTypes: списки без inherit, флаги без состояний и модификаторов', () => {
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

  it('предел матрицы: сначала отбрасываются флаги, затем списки с конца', () => {
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

  it('корень истории - первый элемент с классом «Префикс+Имя-root», иначе запасной селектор', () => {
    const element = (classes, children = []) => ({ classList: classes, children })
    const all = []
    const walk = (node) => {
      all.push(node)
      node.children.forEach(walk)
    }
    const tree = element(
      ['wrapper'],
      [element(['MuiOutlinedInput-root'], [element(['MuiInput-root'])]), element(['MuiIconButton-root'])],
    )
    walk(tree)
    const win = { document: { querySelector: () => ({ querySelectorAll: () => all }), body: {} } }
    expect(findRootSelector(win, 'Input', '#root > *')).toBe('.MuiInput-root')
    expect(findRootSelector(win, 'Button', '#root > *')).toBe('#root > *')
  })
})

describe('исключение значения, на котором падает история', () => {
  const entry = {
    id: 'Select',
    auto: true,
    states: ['default', 'hover', 'disabled'],
    axes: [
      { name: 'Variant', arg: 'variant', exclude: ['inherit'] },
      { name: 'Multiple', values: { false: { multiple: false }, true: { multiple: true } } },
    ],
  }

  it('разбирает вариант из текста ошибки и находит умолчания осей', () => {
    const message =
      'компоненты-mui-inputs-select--basic Variant=standard, Multiple=true, State=default (light): Error: #2'
    expect(failedVariant(message)).toEqual({ Variant: 'standard', Multiple: 'true', State: 'default' })
    expect(failedVariant('что-то другое')).toBeNull()
    const initialArgs = { variant: 'outlined', multiple: false }
    expect(defaultValue(entry, 'Variant', initialArgs)).toBe('outlined')
    expect(defaultValue(entry, 'Multiple', initialArgs)).toBe('false')
    expect(defaultValue(entry, 'State', initialArgs)).toBe('default')
  })

  it('убирает значение флага (ось с одним значением исчезает), списка и состояния', () => {
    expect(withoutValue(entry, 'Multiple', 'true').axes.map((axis) => axis.name)).toEqual(['Variant'])
    expect(withoutValue(entry, 'Variant', 'standard').axes[0].exclude).toEqual(['inherit', 'standard'])
    expect(withoutValue(entry, 'State', 'disabled').states).toEqual(['default', 'hover'])
    expect(withoutValue(entry, 'Size', 'small')).toBeNull()
  })
})
