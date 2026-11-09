import { describe, expect, it } from 'vitest'
import { buildTokens, colorName, letterSpacingOf, lineHeightOf, parseGlow } from './tokens.mjs'

const SANS = '"Inter", system-ui, sans-serif'

/** Тема в формате storyframe: по записи каждого вида и пара заведомо неверных значений. */
function theme(overrides = {}) {
  return {
    fonts: [{ family: 'Inter', weights: [400, 700] }],
    colors: [
      { id: 'palette.primary.main', name: 'primary/main', light: '#403e3c', dark: '#e3847e', description: 'Действия' },
      { id: 'palette.divider', light: 'rgba(54, 50, 47, 0.08)', dark: 'rgba(255, 255, 255, 0.1)' },
      { id: 'palette.background.gradient', light: 'radial-gradient(#fff, #000)' },
      { id: 'palette.text.icon', light: null, dark: 'rgba(255, 255, 255, 0.5)' },
      { id: 'palette.text.link', light: '#1976d2', dark: null },
      { id: 'palette.common.black', light: '#000' },
    ],
    numbers: [{ id: 'shape.borderRadius', name: 'radius/md', value: 11, scope: 'radius' }],
    typography: [
      { id: 'h1', fontFamily: SANS, fontSize: 58.4, fontWeight: 700, lineHeight: 1.167, letterSpacing: '0.08em' },
      {
        id: 'body2',
        name: 'Text/body',
        fontFamily: SANS,
        fontSize: 13.76,
        lineHeight: '20px',
        textTransform: 'uppercase',
      },
      { id: 'code', fontFamily: '"Fira Code", monospace', fontSize: 13, fontWeight: 500 },
    ],
    shadows: [
      { id: 'shadows.1', name: 'Shadow/soft', light: '0 2px 10px rgba(54, 50, 47, 0.06)' },
      { id: 'shadows.2', light: '0 8px 24px rgba(54, 50, 47, 0.1)' },
      { id: 'shadows.3', light: '0 8px 24px rgba(54, 50, 47, 0.1)' },
      { id: 'shadows.4', light: 'не тень' },
    ],
    ...overrides,
  }
}

describe('токены выгрузки из темы storyframe', () => {
  it('цвета обоих режимов в RGBA 0–1; не цвета - в предупреждения, один режим - в описание', () => {
    const { tokens, warnings } = buildTokens(theme())
    const primary = tokens.colors.find((token) => token.id === 'palette.primary.main')
    expect(primary).toMatchObject({ name: 'primary/main', description: 'Действия' })
    expect(primary.light).toEqual({ r: 0.251, g: 0.2431, b: 0.2353, a: 1 })
    expect(primary.dark.r).toBeCloseTo(0.89, 2)
    const divider = tokens.colors.find((token) => token.id === 'palette.divider')
    expect(divider.name).toBe('palette/divider')
    expect(divider.light.a).toBe(0.08)
    const icon = tokens.colors.find((token) => token.id === 'palette.text.icon')
    expect(icon.light).toEqual(icon.dark)
    expect(icon.description).toBe('Задан только в тёмном режиме.')
    expect(tokens.colors.find((token) => token.id === 'palette.text.link').description).toBe(
      'Задан только в светлом режиме.',
    )
    // Без тёмного значения - одно на оба режима, без пометки.
    const black = tokens.colors.find((token) => token.id === 'palette.common.black')
    expect(black.dark).toEqual(black.light)
    expect(black.description).toBe('')
    expect(tokens.colors.some((token) => token.id === 'palette.background.gradient')).toBe(false)
    expect(warnings.some((text) => text.startsWith('palette.background.gradient: не цвет'))).toBe(true)
    expect(colorName('tone.red.bg')).toBe('tone/red/bg')
  })

  it('стили текста в единицах Figma, тени без дублей, сверка со шрифтами темы', () => {
    const { tokens, fonts, warnings } = buildTokens(theme())
    expect(tokens.typography.find((style) => style.id === 'h1')).toMatchObject({
      name: 'Typography/h1',
      family: 'Inter',
      weight: 700,
      sizePx: 58.4,
      lineHeight: { unit: 'percent', value: 116.7 },
      letterSpacing: { unit: 'percent', value: 8 },
      textCase: 'original',
    })
    expect(tokens.typography.find((style) => style.id === 'body2')).toMatchObject({
      name: 'Text/body',
      weight: 400,
      lineHeight: { unit: 'px', value: 20 },
      letterSpacing: { unit: 'px', value: 0 },
      textCase: 'upper',
    })
    expect(tokens.effects.map((effect) => effect.name)).toEqual(['Shadow/soft', 'Shadow/shadows.2'])
    expect(tokens.effects[0].light[0]).toMatchObject({ type: 'drop', blur: 10 })
    expect(warnings).toContain('shadows.4: тень не разобрана (не тень)')
    expect(warnings).toContain('code: семейства Fira Code нет в шрифтах темы')
    expect(fonts).toEqual([{ family: 'Inter', weights: [400, 700] }])
    expect(tokens.numbers).toEqual([
      { id: 'shape.borderRadius', name: 'radius/md', value: 11, scope: 'radius', description: '' },
    ])
  })

  it('начертание вне шрифтов темы - предупреждение; роли и свечение полотна переходят в токены', () => {
    const glow = 'radial-gradient(100% 100% at 0% 0%, rgba(255,0,0,0.2) 0%, rgba(255,0,0,0) 80%)'
    const { tokens, warnings } = buildTokens(
      theme({
        fonts: [{ family: 'Inter', weights: [400] }],
        canvas: { light: glow },
        roles: { canvas: 'palette.background.default' },
      }),
    )
    expect(warnings).toContain('h1: начертания 700 нет в шрифтах темы')
    expect(tokens.canvas.light).toHaveLength(1)
    expect(tokens.canvas.dark).toEqual(tokens.canvas.light)
    expect(tokens.roles).toEqual({ canvas: 'palette.background.default' })
    expect(buildTokens(theme()).tokens).not.toHaveProperty('roles')
  })

  it('подсказки адаптера переходят в токены, без пустых ключей', () => {
    const { tokens } = buildTokens(
      theme({
        colors: [
          {
            id: 'primary',
            light: '#000',
            code: 'var(--color-primary)',
            group: 'primary',
            priority: { fill: 0 },
            text: false,
          },
        ],
        numbers: [{ id: 'radius.full', name: 'radius/full', value: 9999, scope: 'radius', circle: true }],
        shadows: [{ id: 'shadow.sm', light: '0 1px 2px rgba(0, 0, 0, 0.1)', code: 'var(--shadow-sm)' }],
      }),
    )
    expect(tokens.colors[0]).toMatchObject({
      code: 'var(--color-primary)',
      group: 'primary',
      priority: { fill: 0 },
      text: false,
    })
    expect(tokens.numbers[0].circle).toBe(true)
    expect(tokens.effects[0].code).toBe('var(--shadow-sm)')
    expect(tokens.typography.find((style) => style.id === 'h1')).not.toHaveProperty('code')
  })

  it('интерлиньяж и разрядка CSS', () => {
    expect(lineHeightOf('22px')).toEqual({ unit: 'px', value: 22 })
    expect(lineHeightOf(undefined)).toEqual({ unit: 'percent', value: 120 })
    expect(letterSpacingOf('0.01071em')).toEqual({ unit: 'percent', value: 1.07 })
    expect(letterSpacingOf('-0.5px')).toEqual({ unit: 'px', value: -0.5 })
  })
})

describe('parseGlow', () => {
  it('переводит radial-gradient в центр, радиусы и стопы в долях', () => {
    const css =
      'radial-gradient(140% 140% at 0% 0%, rgba(255,166,120,0.14) 0%, rgba(255,255,255,0) 85%), ' +
      'radial-gradient(120% 120% at 100% 0%, rgba(255, 172, 128, 0.07) 0%, rgba(255,255,255,0) 70%)'
    const glows = parseGlow(css)
    expect(glows).toHaveLength(2)
    expect(glows[0]).toMatchObject({ cx: 0, cy: 0, rx: 1.4, ry: 1.4 })
    expect(glows[0].stops[0]).toEqual({ pos: 0, color: { r: 1, g: 0.651, b: 0.4706, a: 0.14 } })
    expect(glows[1]).toMatchObject({ cx: 1, cy: 0, rx: 1.2 })
    expect(glows[1].stops[1].pos).toBe(0.7)
    expect(parseGlow(undefined)).toEqual([])
  })
})
