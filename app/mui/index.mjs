/*
 * MUI theme adapter: a theme in the storyframe format from a pair of `createTheme` themes (light and dark).
 * Colors are the `palette` leaves, numbers are `shape` and the `spacing` steps, text styles are the `typography`
 * variants, shadows are `shadows`. Knowledge of the MUI conventions (how a token is written in code, groups and
 * priorities of palette colors, text colors) lives here, not in the core. Everything that differs between
 * projects (names of radii and shadows, extra text styles, canvas glow, descriptions, fonts, palette
 * extensions) is set through options. The module has no dependencies: it works both in Node and in the
 * project's Vite.
 */

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
export const MUI_COLOR_PRIORITY = {
  fill: [/^palette\.background\./, /\.main$/, /\.light$/, /^palette\.action\./],
  text: [/^palette\.text\./, /\.contrastText$/, /\.main$/, /\.dark$/],
  stroke: [/^palette\.divider$/, /^palette\.grey\./, /\.main$/, /\.light$/],
}

/** MUI text colors: `palette.text.*` and `*.contrastText`. */
export const MUI_TEXT_COLOR = /^palette\.(text\.|.*\.contrastText$)/

/** Index of the first matching pattern for each role; roles without a match are not written. */
function priorityOf(address, lists) {
  const priority = {}
  for (const [role, patterns] of Object.entries(lists)) {
    const position = patterns.findIndex((pattern) => pattern.test(address))
    if (position !== -1) priority[role] = position
  }
  return Object.keys(priority).length > 0 ? priority : undefined
}

function leaves(value, address, out) {
  if (typeof value === 'string') out.set(address, value)
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) leaves(child, `${address}.${key}`, out)
  }
  return out
}

/** String leaves of the palette (`palette.primary.main` → value); `mode` and functions are skipped. */
function paletteLeaves(theme) {
  const out = new Map()
  for (const [key, value] of Object.entries(theme.palette ?? {}))
    if (key !== 'mode') leaves(value, `palette.${key}`, out)
  return out
}

function valueAt(theme, address) {
  return address.split('.').reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), theme)
}

/** Variant font size in px: `rem` is relative to `htmlFontSize`, `px` and a number are taken as is. */
function fontSizePx(size, htmlFontSize) {
  if (typeof size === 'number') return size
  if (typeof size !== 'string') return null
  if (size.endsWith('rem')) return Math.round(parseFloat(size) * htmlFontSize * 100) / 100
  if (size.endsWith('px')) return parseFloat(size)
  return null
}

function firstFamily(fontFamily) {
  return String(fontFamily ?? '')
    .split(',')[0]
    .trim()
    .replace(/^["']|["']$/g, '')
}

/**
 * @param {import('./index.d.mts').IMuiThemeOptions} options
 * @returns {import('../theme.d.mts').IStoryframeTheme}
 */
export function muiTheme(options) {
  const { light, dark = light, describe = () => '' } = options
  const lightColors = paletteLeaves(light)
  const darkColors = paletteLeaves(dark)
  const priorityLists = { ...MUI_COLOR_PRIORITY, ...options.colorPriority }
  const textColor = options.textColor ?? MUI_TEXT_COLOR
  const colors = [...new Set([...lightColors.keys(), ...darkColors.keys()])].map((address) => {
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

  const radii =
    options.radii ??
    Object.fromEntries(
      Object.entries(light.shape ?? {})
        .filter(([, value]) => typeof value === 'number')
        .map(([key]) => [key, key]),
    )
  const numbers = []
  for (const [key, name] of Object.entries(radii)) {
    const value = light.shape?.[key]
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

  const htmlFontSize = light.typography?.htmlFontSize ?? 16
  const typography = []
  for (const [variant, style] of Object.entries(light.typography ?? {})) {
    if (variant === 'inherit' || !style || typeof style !== 'object' || !('fontSize' in style)) continue
    const fontSize = fontSizePx(style.fontSize, htmlFontSize)
    if (fontSize === null) continue
    const entry = {
      id: `typography.${variant}`,
      name: `Typography/${variant}`,
      fontFamily: style.fontFamily ?? light.typography.fontFamily,
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

  const shadows = []
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

  const canvasOf = (theme) => {
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
