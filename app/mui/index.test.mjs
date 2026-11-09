import { createTheme } from '@mui/material/styles'
import { describe, expect, it } from 'vitest'
import { validateTheme } from '../export/theme.mjs'
import { buildTokens } from '../export/tokens.mjs'
import { MUI_ROLES, muiTheme } from './index.mjs'

const light = createTheme({
  palette: { mode: 'light', primary: { main: '#403e3c' }, background: { gradient: 'radial-gradient(#fff, #000)' } },
  shape: { borderRadius: 11, borderRadiusSm: 8, knobSize: 'auto' },
  typography: { fontFamily: '"Manrope", sans-serif' },
  shadows: ['none', '0 2px 10px rgba(0, 0, 0, 0.06)', ...Array(23).fill('0 8px 24px rgba(0, 0, 0, 0.1)')],
})
const dark = createTheme({ palette: { mode: 'dark', primary: { main: '#e3847e' } } })

describe('адаптер темы MUI', () => {
  it('строит тему в формате storyframe из createTheme обоих режимов', () => {
    const theme = muiTheme({ light, dark })
    expect(validateTheme(theme)).toEqual([])
    const primary = theme.colors.find((color) => color.id === 'palette.primary.main')
    expect(primary).toMatchObject({ name: 'primary/main', light: '#403e3c', dark: '#e3847e' })
    // Лист только одной темы (градиент полотна) - цвет, не заданный в другом режиме; функции палитры не листья.
    expect(theme.colors.find((color) => color.id === 'palette.background.gradient')).toMatchObject({
      light: 'radial-gradient(#fff, #000)',
      dark: null,
    })
    expect(theme.colors.some((color) => color.id.includes('getContrastText') || color.id === 'palette.mode')).toBe(
      false,
    )
    expect(theme.roles).toEqual(MUI_ROLES)
  })

  it('числа: все числа shape по умолчанию, шаги spacing в px', () => {
    const theme = muiTheme({ light })
    expect(
      theme.numbers.filter((number) => number.scope === 'radius').map((number) => [number.name, number.value]),
    ).toEqual([
      ['radius/borderRadius', 11],
      ['radius/borderRadiusSm', 8],
    ])
    expect(theme.numbers.find((number) => number.id === 'spacing.0.5')).toMatchObject({ name: 'spacing/0_5', value: 4 })
    const named = muiTheme({ light, radii: { borderRadiusSm: 'sm' }, spacing: [1] })
    expect(named.numbers.map((number) => number.name)).toEqual(['radius/sm', 'spacing/1'])
  })

  it('стили текста в px от rem, дополнительное семейство, шрифты по стилям', () => {
    const theme = muiTheme({
      light,
      extraTypography: [{ prefix: 'mono', fontFamily: '"JetBrains Mono", monospace', variants: ['body2'] }],
    })
    const h1 = theme.typography.find((style) => style.id === 'typography.h1')
    expect(h1).toMatchObject({
      name: 'Typography/h1',
      fontSize: 96,
      fontWeight: 300,
      fontFamily: '"Manrope", sans-serif',
    })
    expect(theme.typography.some((style) => style.id === 'typography.inherit')).toBe(false)
    expect(theme.typography.find((style) => style.id === 'typography.mono.body2')).toMatchObject({
      name: 'Typography/mono/body2',
      fontSize: 14,
      fontFamily: '"JetBrains Mono", monospace',
    })
    expect(theme.fonts).toEqual([
      { family: 'Manrope', weights: [300, 400, 500] },
      { family: 'JetBrains Mono', weights: [400] },
    ])
  })

  it('тени с именами, свечение полотна по адресу, описания и роли из опций', () => {
    const theme = muiTheme({
      light,
      shadowNames: { 1: 'soft' },
      canvas: 'palette.background.gradient',
      describe: (address) => (address === 'palette.primary.main' ? 'Действия' : undefined),
      roles: { heading: 'typography.h6' },
    })
    expect(theme.shadows[0]).toMatchObject({ id: 'shadows.1', name: 'Shadow/soft' })
    expect(theme.shadows[1].name).toBe('Shadow/2')
    expect(theme.canvas).toEqual({ light: 'radial-gradient(#fff, #000)', dark: 'radial-gradient(#fff, #000)' })
    expect(theme.colors.find((color) => color.id === 'palette.primary.main').description).toBe('Действия')
    expect(theme.roles.heading).toBe('typography.h6')
    // Одинаковые тени под разными номерами - один стиль эффекта.
    expect(buildTokens(theme).tokens.effects.map((effect) => effect.name)).toEqual(['Shadow/soft', 'Shadow/2'])
  })
})

describe('соглашения MUI в адаптере', () => {
  it('код, группа, приоритеты и цвета текста - по адресам палитры MUI', () => {
    const theme = muiTheme({ light, dark, circleRadius: 'borderRadiusSm' })
    const byId = new Map(theme.colors.map((color) => [color.id, color]))
    expect(byId.get('palette.primary.main')).toMatchObject({
      code: 'theme.palette.primary.main',
      group: 'primary',
      priority: { fill: 1, text: 2, stroke: 2 },
      text: false,
    })
    expect(byId.get('palette.primary.contrastText')).toMatchObject({ priority: { text: 1 }, text: true })
    expect(byId.get('palette.text.secondary')).toMatchObject({ group: 'text', priority: { text: 0 }, text: true })
    expect(byId.get('palette.common.black')).not.toHaveProperty('priority')
    expect(theme.numbers.find((number) => number.id === 'shape.borderRadiusSm')).toMatchObject({
      code: 'theme.shape.borderRadiusSm',
      circle: true,
    })
    expect(theme.numbers.find((number) => number.id === 'shape.borderRadius')).not.toHaveProperty('circle')
    expect(theme.typography.find((style) => style.id === 'typography.h1').code).toBe('theme.typography.h1')
    expect(theme.shadows[0].code).toBe('theme.shadows.1')
  })

  it('палитра с расширениями задаёт свои приоритеты и цвета текста', () => {
    const theme = muiTheme({
      light,
      colorPriority: { fill: [/\.light$/, /\.main$/] },
      textColor: /\.contrastText$/,
    })
    const main = theme.colors.find((color) => color.id === 'palette.primary.main')
    // Список роли заменяется целиком, остальные роли - по умолчанию MUI.
    expect(main.priority).toEqual({ fill: 1, text: 2, stroke: 2 })
    expect(theme.colors.find((color) => color.id === 'palette.text.primary').text).toBe(false)
  })
})

describe('проверка темы', () => {
  it('нарушения формата - путь и сообщение', () => {
    const issues = validateTheme({ fonts: [], colors: [{ id: 'x' }], numbers: [], typography: [], shadows: [] })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatch(/^colors\.0\.light: /)
  })
})
