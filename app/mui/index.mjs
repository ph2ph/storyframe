/*
 * Адаптер темы MUI: тема в формате storyframe из пары тем `createTheme` (светлой и тёмной). Цвета - листья
 * `palette`, числа - `shape` и шаги `spacing`, стили текста - варианты `typography`, тени - `shadows`. Знания
 * о соглашениях MUI (как токен пишут в коде, группы и приоритеты цветов палитры, цвета текста) живут здесь, а
 * не в ядре. Всё, что у проектов разное (имена скруглений и теней, дополнительные стили текста, свечение
 * полотна, описания, шрифты, расширения палитры), задаётся опциями. Модуль без зависимостей: он работает и в
 * Node, и в Vite проекта.
 */

/** Шаги `theme.spacing(n)`, которые идут переменными отступов. */
const SPACING_STEPS = [0.5, 1, 1.5, 2, 3, 4, 6, 8]

/** Роли оформления плагина - адреса темы MUI: полотно, текст трёх уровней, разделитель, стили подписей. */
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
 * Приоритеты цветов MUI по роли краски: среди токенов с одинаковыми значениями побеждает адрес, подошедший
 * к шаблону раньше (заливка - фон, затем `main`; текст - `palette.text`, затем `contrastText`). Палитра с
 * расширениями передаёт свои списки опцией `colorPriority`.
 */
export const MUI_COLOR_PRIORITY = {
  fill: [/^palette\.background\./, /\.main$/, /\.light$/, /^palette\.action\./],
  text: [/^palette\.text\./, /\.contrastText$/, /\.main$/, /\.dark$/],
  stroke: [/^palette\.divider$/, /^palette\.grey\./, /\.main$/, /\.light$/],
}

/** Цвета текста MUI: `palette.text.*` и `*.contrastText`. */
export const MUI_TEXT_COLOR = /^palette\.(text\.|.*\.contrastText$)/

/** Номер первого подходящего шаблона по каждой роли; роли без совпадения не пишутся. */
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

/** Строковые листья палитры (`palette.primary.main` → значение); `mode` и функции пропускаются. */
function paletteLeaves(theme) {
  const out = new Map()
  for (const [key, value] of Object.entries(theme.palette ?? {}))
    if (key !== 'mode') leaves(value, `palette.${key}`, out)
  return out
}

function valueAt(theme, address) {
  return address.split('.').reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), theme)
}

/** Кегль варианта в px: `rem` - от `htmlFontSize`, `px` и число - как есть. */
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
      // Листа нет в теме режима - цвет в нём не задан.
      light: lightColors.get(address) ?? null,
      dark: darkColors.get(address) ?? null,
      description: describe(address) || '',
      code: `theme.${address}`,
      // Группа - ключ палитры: подпись к фону `primary.main` берёт `primary.contrastText`.
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
    // В имени переменной Figma точка недопустима: `spacing/0_5`.
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

  // Шрифты по умолчанию - семейства и начертания стилей текста темы.
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
