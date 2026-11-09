/*
 * MUI theme adapter: a theme in the storyframe format from a pair of `createTheme` themes (light and dark).
 * Colors are the `palette` leaves, numbers are `shape` and the `spacing` steps, text styles are the `typography`
 * variants, shadows are `shadows`. Knowledge of the MUI conventions (how a token is written in code, groups and
 * priorities of palette colors, text colors) lives here, not in the core. Everything that differs between
 * projects (names of radii and shadows, extra text styles, canvas glow, descriptions, fonts, palette
 * extensions) is set through options. The module has no dependencies: it works both in Node and in the
 * project's Vite.
 */

import type {
  IStoryframeColor,
  IStoryframeNumber,
  IStoryframeShadow,
  IStoryframeTheme,
  IStoryframeTypography,
} from '../theme.ts'

/**
 * MUI theme to the extent the adapter reads it: the result of `createTheme` fits as is. The type is open so
 * that storyframe does not depend on the `@mui/material` version.
 */
export interface IMuiThemeLike {
  palette?: object
  shape?: object
  spacing: (step: number) => string | number
  typography?: object
  shadows?: readonly string[]
}

export interface IMuiThemeOptions {
  light: IMuiThemeLike
  /** Dark theme; without it both modes take the light one. */
  dark?: IMuiThemeLike
  /** Theme fonts and their weights. By default, the families and weights of the text styles. */
  fonts?: { family: string; weights: number[] }[]
  /** Corner radii: `theme.shape` key → variable name (`borderRadius` → `md`). By default, all numbers of `shape`. */
  radii?: Record<string, string>
  /** `theme.spacing(n)` steps that become spacing variables. Defaults to 0.5, 1, 1.5, 2, 3, 4, 6, 8. */
  spacing?: number[]
  /** Shadow names by `theme.shadows` index (`{ 1: 'xs' }`). By default, the index. */
  shadowNames?: Record<number, string>
  /** Extra text styles: variants with a different family (`Typography/mono/body1`). */
  extraTypography?: { prefix: string; fontFamily: string; variants: string[] }[]
  /** Canvas glow: the value path in the theme (`palette.background.gradient`) or a function of the mode's theme. */
  canvas?: string | ((theme: IMuiThemeLike) => string | undefined)
  /** Token description by path (`palette.primary.main`, `shape.borderRadius`). */
  describe?: (address: string) => string | undefined
  /** Plugin decoration roles on top of the default MUI roles. */
  roles?: Partial<Record<keyof typeof MUI_ROLES, string>>
  /**
   * Priorities of colors with the same values per paint role instead of `MUI_COLOR_PRIORITY` (role lists are
   * replaced as a whole): the first matching path pattern wins. For a palette with extensions.
   */
  colorPriority?: Partial<Record<TPaintRole, RegExp[]>>
  /** Which palette paths are text colors, instead of `MUI_TEXT_COLOR`. */
  textColor?: RegExp
  /** The `theme.shape` key with the "full circle" corner radius (pills, avatars). */
  circleRadius?: string
}

/** Paint roles that have their own color priorities. */
type TPaintRole = 'fill' | 'text' | 'stroke'

/** Color priorities per paint role, as the storyframe theme writes them. */
type TColorPriority = NonNullable<IStoryframeColor['priority']>

/** A `theme.typography` variant: the CSS values of the style the adapter reads. */
interface IMuiTypographyStyle {
  fontSize?: unknown
  fontFamily?: string
  fontWeight?: number | string
  lineHeight?: number | string
  letterSpacing?: number | string
  textTransform?: string
}

/**
 * `theme.typography` of `createTheme`: the variants, the base values (`fontFamily`, `htmlFontSize`) and helper
 * functions (`pxToRem`).
 */
type TMuiTypography = Record<
  string,
  IMuiTypographyStyle | string | number | ((...args: never[]) => unknown) | undefined
> & { htmlFontSize?: number; fontFamily: string }

/** `theme.spacing(n)` steps that become spacing variables. */
const SPACING_STEPS = [0.5, 1, 1.5, 2, 3, 4, 6, 8]

/** Plugin decoration roles as MUI theme paths: canvas, text of three levels, divider, label styles. */
export const MUI_ROLES = {
  canvas: 'palette.background.default',
  text: 'palette.text.primary',
  textSecondary: 'palette.text.secondary',
  textDisabled: 'palette.text.disabled',
  divider: 'palette.divider',
  title: 'typography.h4',
  heading: 'typography.h5',
  subheading: 'typography.subtitle2',
  body: 'typography.body2',
  caption: 'typography.caption',
}

/**
 * MUI color priorities per paint role: among tokens with the same values the path that matched a pattern
 * earlier wins (fill: background, then `main`; text: `palette.text`, then `contrastText`). A palette with
 * extensions passes its own lists through the `colorPriority` option.
 */
export const MUI_COLOR_PRIORITY: Record<TPaintRole, RegExp[]> = {
  fill: [/^palette\.background\./, /\.main$/, /\.light$/, /^palette\.action\./],
  text: [/^palette\.text\./, /\.contrastText$/, /\.main$/, /\.dark$/],
  stroke: [/^palette\.divider$/, /^palette\.grey\./, /\.main$/, /\.light$/],
}

/** MUI text colors: `palette.text.*` and `*.contrastText`. */
export const MUI_TEXT_COLOR = /^palette\.(text\.|.*\.contrastText$)/

/** Index of the first matching pattern for each role; roles without a match are not written. */
function priorityOf(address: string, lists: Record<TPaintRole, RegExp[]>): TColorPriority | undefined {
  const priority: TColorPriority = {}
  for (const [role, patterns] of Object.entries(lists)) {
    const position = patterns.findIndex((pattern) => pattern.test(address))
    if (position !== -1) priority[role as TPaintRole] = position
  }
  return Object.keys(priority).length > 0 ? priority : undefined
}

function leaves(value: unknown, address: string, out: Map<string, string>): Map<string, string> {
  if (typeof value === 'string') out.set(address, value)
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) leaves(child, `${address}.${key}`, out)
  }
  return out
}

/** String leaves of the palette (`palette.primary.main` → value); `mode` and functions are skipped. */
function paletteLeaves(theme: IMuiThemeLike): Map<string, string> {
  const out = new Map<string, string>()
  for (const [key, value] of Object.entries(theme.palette ?? {}))
    if (key !== 'mode') leaves(value, `palette.${key}`, out)
  return out
}

function valueAt(theme: IMuiThemeLike, address: string): unknown {
  return address
    .split('.')
    .reduce<unknown>(
      (value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined),
      theme,
    )
}

/** Variant font size in px: `rem` is relative to `htmlFontSize`, `px` and a number are taken as is. */
function fontSizePx(size: unknown, htmlFontSize: number): number | null {
  if (typeof size === 'number') return size
  if (typeof size !== 'string') return null
  if (size.endsWith('rem')) return Math.round(parseFloat(size) * htmlFontSize * 100) / 100
  if (size.endsWith('px')) return parseFloat(size)
  return null
}

function firstFamily(fontFamily: string | undefined): string {
  return String(fontFamily ?? '')
    .split(',')[0]
    .trim()
    .replace(/^["']|["']$/g, '')
}

export function muiTheme(options: IMuiThemeOptions): IStoryframeTheme {
  const { light, dark = light, describe = () => '' } = options
  const lightColors = paletteLeaves(light)
  const darkColors = paletteLeaves(dark)
  const priorityLists = { ...MUI_COLOR_PRIORITY, ...options.colorPriority }
  const textColor = options.textColor ?? MUI_TEXT_COLOR
  const colors: IStoryframeColor[] = [...new Set([...lightColors.keys(), ...darkColors.keys()])].map((address) => {
    const priority = priorityOf(address, priorityLists)
    return {
      id: address,
      name: address.replace(/^palette\./, '').replaceAll('.', '/'),
      // The leaf is absent from the mode's theme, so the color is not set in it.
      light: lightColors.get(address) ?? null,
      dark: darkColors.get(address) ?? null,
      description: describe(address) || '',
      code: `theme.${address}`,
      // The group is the palette key: a label on a `primary.main` background takes `primary.contrastText`.
      group: address.split('.')[1] ?? '',
      ...(priority ? { priority } : {}),
      text: textColor.test(address),
    }
  })

  const radii: Record<string, string> =
    options.radii ??
    Object.fromEntries(
      Object.entries((light.shape ?? {}) as Record<string, unknown>)
        .filter(([, value]) => typeof value === 'number')
        .map(([key]) => [key, key]),
    )
  const numbers: IStoryframeNumber[] = []
  for (const [key, name] of Object.entries(radii)) {
    const value = (light.shape as Record<string, unknown> | undefined)?.[key]
    if (typeof value !== 'number') continue
    numbers.push({
      id: `shape.${key}`,
      name: `radius/${name}`,
      value,
      scope: 'radius',
      description: describe(`shape.${key}`) || '',
      code: `theme.shape.${key}`,
      ...(key === options.circleRadius ? { circle: true } : {}),
    })
  }
  for (const step of options.spacing ?? SPACING_STEPS) {
    // A dot is not allowed in a Figma variable name: `spacing/0_5`.
    numbers.push({
      id: `spacing.${step}`,
      name: `spacing/${String(step).replace('.', '_')}`,
      value: parseFloat(String(light.spacing(step))),
      scope: 'gap',
      description: `theme.spacing(${step})`,
      code: `theme.spacing.${step}`,
    })
  }

  const htmlFontSize = (light.typography as TMuiTypography | undefined)?.htmlFontSize ?? 16
  const typography: IStoryframeTypography[] = []
  for (const [variant, style] of Object.entries((light.typography ?? {}) as TMuiTypography)) {
    if (variant === 'inherit' || !style || typeof style !== 'object' || !('fontSize' in style)) continue
    const fontSize = fontSizePx(style.fontSize, htmlFontSize)
    if (fontSize === null) continue
    const entry = {
      id: `typography.${variant}`,
      name: `Typography/${variant}`,
      fontFamily: style.fontFamily ?? (light.typography as TMuiTypography).fontFamily,
      fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      textTransform: style.textTransform,
      code: `theme.typography.${variant}`,
    }
    typography.push(entry)
    for (const extra of options.extraTypography ?? []) {
      if (!extra.variants.includes(variant)) continue
      typography.push({
        ...entry,
        id: `typography.${extra.prefix}.${variant}`,
        name: `Typography/${extra.prefix}/${variant}`,
        fontFamily: extra.fontFamily,
        code: `theme.typography.${extra.prefix}.${variant}`,
      })
    }
  }

  const shadows: IStoryframeShadow[] = []
  ;(light.shadows ?? []).forEach((shadow, index) => {
    if (index === 0 || shadow === 'none') return
    shadows.push({
      id: `shadows.${index}`,
      name: `Shadow/${options.shadowNames?.[index] ?? index}`,
      light: shadow,
      dark: dark.shadows?.[index] ?? shadow,
      code: `theme.shadows.${index}`,
    })
  })

  const canvasOf = (theme: IMuiThemeLike): string | undefined => {
    if (typeof options.canvas === 'function') return options.canvas(theme)
    if (typeof options.canvas === 'string') {
      const value = valueAt(theme, options.canvas)
      return typeof value === 'string' ? value : undefined
    }
    return undefined
  }

  // The default fonts are the families and weights of the theme's text styles.
  const fonts =
    options.fonts ??
    [...new Set(typography.map((style) => firstFamily(style.fontFamily)))].map((family) => ({
      family,
      weights: [
        ...new Set(
          typography
            .filter((style) => firstFamily(style.fontFamily) === family)
            .map((style) => Number(style.fontWeight ?? 400)),
        ),
      ].sort((a, b) => a - b),
    }))

  return {
    fonts,
    colors,
    numbers,
    typography,
    shadows,
    canvas: { light: canvasOf(light), dark: canvasOf(dark) },
    roles: { ...MUI_ROLES, ...options.roles },
  }
}
