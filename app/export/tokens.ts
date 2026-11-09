/*
 * Export tokens from the project theme in storyframe format (`theme.mjs`): colors of both modes, corner radius
 * and gap numbers, text styles, shadows, canvas glow, roles for the plugin's styling. The theme gives values in
 * CSS, here they are converted to Figma units: RGBA 0–1, line height and letter spacing in percent, sizes in px.
 */

import type { IStoryframeFont, IStoryframeTheme } from '../theme.ts'
import { firstFamily, parseBoxShadow, parseColor, parsePx } from './capture/css.ts'
import type {
  ICanvasGlow,
  IColorToken,
  IEffectToken,
  IKitTokens,
  INumberToken,
  IRgba,
  ITypographyToken,
} from './capture/types.ts'

/** Tokens of the export (the canvas glow is always set), the theme fonts and the warnings about skipped values. */
export interface ITokensBuild {
  tokens: IKitTokens & { canvas: NonNullable<IKitTokens['canvas']> }
  fonts: IStoryframeFont[]
  warnings: string[]
}

/** Figma variable name from the token path: dots are group levels (`tone.red.bg` → `tone/red/bg`). */
export function colorName(id: string): string {
  return id.replaceAll('.', '/')
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** CSS line height → Figma units: a number is a multiplier (percent), `px` is pixels. */
export function lineHeightOf(value: unknown): ITypographyToken['lineHeight'] {
  if (typeof value === 'number') return { unit: 'percent', value: round(value * 100, 1) }
  if (typeof value === 'string' && value.endsWith('px')) return { unit: 'px', value: parsePx(value) }
  return { unit: 'percent', value: 120 }
}

/** CSS letter spacing → Figma units: `em` is percent of the font size, `px` or a number is pixels. */
export function letterSpacingOf(value: unknown): ITypographyToken['letterSpacing'] {
  if (typeof value === 'string' && value.endsWith('em'))
    return { unit: 'percent', value: round(parseFloat(value) * 100) }
  if (typeof value === 'string' && value.endsWith('px')) return { unit: 'px', value: parsePx(value) }
  return { unit: 'px', value: typeof value === 'number' ? value : 0 }
}

/** Optional theme fields set by the adapter, without keys whose value is `undefined`. */
function given<TFields extends Record<string, unknown>>(fields: TFields): Partial<TFields> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Partial<TFields>
}

function textCaseOf(transform: string | undefined): ITypographyToken['textCase'] {
  if (transform === 'uppercase') return 'upper'
  if (transform === 'lowercase') return 'lower'
  if (transform === 'capitalize') return 'title'
  return 'original'
}

/**
 * Canvas glow: CSS `radial-gradient(W% H% at X% Y%, stops)` into box fractions and RGBA 0–1; in Figma these are
 * GRADIENT_RADIAL layers over the canvas color.
 */
export function parseGlow(css: unknown): ICanvasGlow[] {
  if (typeof css !== 'string') return []
  const glows: ICanvasGlow[] = []
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
 * @param theme the project theme in storyframe format
 */
export function buildTokens(theme: IStoryframeTheme): ITokensBuild {
  const warnings: string[] = []

  const colors: IColorToken[] = []
  for (const color of theme.colors) {
    // No dark value means one value for both modes; `null` means the color is not set in that mode.
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
      // At least one of the modes parsed: the check above skips the color otherwise.
      light: (light ?? dark) as IRgba,
      dark: (dark ?? light) as IRgba,
      description,
      ...given({ code: color.code, group: color.group, priority: color.priority, text: color.text }),
    })
  }

  const numbers: INumberToken[] = theme.numbers.map((number) => ({ ...number, description: number.description ?? '' }))

  const typography: ITypographyToken[] = theme.typography.map((style) => ({
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

  const effects: IEffectToken[] = []
  const seen = new Set<string>()
  for (const shadow of theme.shadows) {
    const dark = shadow.dark ?? shadow.light
    // Identical shadows under different numbers are one effect style.
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
