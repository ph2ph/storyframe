/*
 * Токены выгрузки из темы проекта в формате storyframe (`theme.mjs`): цвета обоих режимов, числа скруглений
 * и отступов, стили текста, тени, свечение полотна, роли оформления плагина. Тема даёт значения в CSS,
 * здесь они переводятся в единицы Figma: RGBA 0–1, интерлиньяж и разрядка в процентах, размеры в px.
 */

import { firstFamily, parseBoxShadow, parseColor, parsePx } from './capture/css.ts'

/** Имя переменной Figma по адресу токена: точки - уровни группы (`tone.red.bg` → `tone/red/bg`). */
export function colorName(id) {
  return id.replaceAll('.', '/')
}

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** Интерлиньяж CSS → единицы Figma: число - множитель (проценты), `px` - пиксели. */
export function lineHeightOf(value) {
  if (typeof value === 'number') return { unit: 'percent', value: round(value * 100, 1) }
  if (typeof value === 'string' && value.endsWith('px')) return { unit: 'px', value: parsePx(value) }
  return { unit: 'percent', value: 120 }
}

/** Разрядка CSS → единицы Figma: `em` - проценты от кегля, `px` или число - пиксели. */
export function letterSpacingOf(value) {
  if (typeof value === 'string' && value.endsWith('em'))
    return { unit: 'percent', value: round(parseFloat(value) * 100) }
  if (typeof value === 'string' && value.endsWith('px')) return { unit: 'px', value: parsePx(value) }
  return { unit: 'px', value: typeof value === 'number' ? value : 0 }
}

/** Необязательные поля темы, которые задал адаптер, - без ключей со значением `undefined`. */
function given(fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
}

function textCaseOf(transform) {
  if (transform === 'uppercase') return 'upper'
  if (transform === 'lowercase') return 'lower'
  if (transform === 'capitalize') return 'title'
  return 'original'
}

/**
 * Свечение полотна: CSS `radial-gradient(W% H% at X% Y%, стопы)` в доли бокса и RGBA 0–1 - в Figma это слои
 * GRADIENT_RADIAL поверх цвета полотна.
 * @param {unknown} css
 * @returns {{ cx: number, cy: number, rx: number, ry: number, stops: { pos: number, color: { r: number, g: number, b: number, a: number } }[] }[]}
 */
export function parseGlow(css) {
  if (typeof css !== 'string') return []
  const glows = []
  for (const chunk of css.split(/radial-gradient\(/).slice(1)) {
    const head = /^\s*([\d.]+)%\s+([\d.]+)%\s+at\s+([\d.]+)%\s+([\d.]+)%\s*,/.exec(chunk)
    if (!head) continue
    const stops = [
      ...chunk.matchAll(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)\s*([\d.]+)%/g),
    ].map((match) => ({
      pos: round(Number(match[5]) / 100, 4),
      color: {
        r: round(Number(match[1]) / 255, 4),
        g: round(Number(match[2]) / 255, 4),
        b: round(Number(match[3]) / 255, 4),
        a: match[4] === undefined ? 1 : round(Number(match[4]), 4),
      },
    }))
    if (stops.length < 2) continue
    glows.push({
      rx: round(Number(head[1]) / 100, 4),
      ry: round(Number(head[2]) / 100, 4),
      cx: round(Number(head[3]) / 100, 4),
      cy: round(Number(head[4]) / 100, 4),
      stops,
    })
  }
  return glows
}

/**
 * @param {import('./theme.mjs').IStoryframeTheme} theme тема проекта в формате storyframe
 */
export function buildTokens(theme) {
  const warnings = []

  const colors = []
  for (const color of theme.colors) {
    // Нет тёмного значения - одно на оба режима; `null` - в режиме цвет не задан.
    const lightCss = color.light
    const darkCss = color.dark === undefined ? color.light : color.dark
    const light = lightCss === null ? null : parseColor(lightCss)
    const dark = darkCss === null ? null : parseColor(darkCss)
    if (!light && !dark) {
      warnings.push(`${color.id}: не цвет (${lightCss ?? darkCss}), в токены не вошёл`)
      continue
    }
    let description = color.description ?? ''
    if (!light || !dark) {
      description = `${description} Задан только в ${light ? 'светлом' : 'тёмном'} режиме.`.trim()
    }
    colors.push({
      id: color.id,
      name: color.name ?? colorName(color.id),
      light: light ?? dark,
      dark: dark ?? light,
      description,
      ...given({ code: color.code, group: color.group, priority: color.priority, text: color.text }),
    })
  }

  const numbers = theme.numbers.map((number) => ({ ...number, description: number.description ?? '' }))

  const typography = theme.typography.map((style) => ({
    id: style.id,
    name: style.name ?? `Typography/${style.id}`,
    family: firstFamily(style.fontFamily),
    weight: Number(style.fontWeight ?? 400),
    sizePx: round(style.fontSize),
    lineHeight: lineHeightOf(style.lineHeight),
    letterSpacing: letterSpacingOf(style.letterSpacing),
    textCase: textCaseOf(style.textTransform),
    ...given({ code: style.code }),
  }))

  const effects = []
  const seen = new Set()
  for (const shadow of theme.shadows) {
    const dark = shadow.dark ?? shadow.light
    // Одинаковые тени под разными номерами - один стиль эффекта.
    const key = `${shadow.light}|${dark}`
    if (seen.has(key)) continue
    seen.add(key)
    const lightEffects = parseBoxShadow(shadow.light)
    const darkEffects = parseBoxShadow(dark)
    if (lightEffects.length === 0) {
      warnings.push(`${shadow.id}: тень не разобрана (${shadow.light})`)
      continue
    }
    effects.push({
      id: shadow.id,
      name: shadow.name ?? `Shadow/${shadow.id}`,
      light: lightEffects,
      dark: darkEffects.length === lightEffects.length ? darkEffects : lightEffects,
      ...given({ code: shadow.code }),
    })
  }

  for (const token of typography) {
    const font = theme.fonts.find((item) => item.family === token.family)
    if (!font) warnings.push(`${token.id}: семейства ${token.family} нет в шрифтах темы`)
    else if (!font.weights.includes(token.weight))
      warnings.push(`${token.id}: начертания ${token.weight} нет в шрифтах темы`)
  }

  const canvas = { light: parseGlow(theme.canvas?.light), dark: parseGlow(theme.canvas?.dark ?? theme.canvas?.light) }
  return {
    tokens: { colors, numbers, typography, effects, canvas, ...(theme.roles ? { roles: theme.roles } : {}) },
    fonts: theme.fonts,
    warnings,
  }
}
