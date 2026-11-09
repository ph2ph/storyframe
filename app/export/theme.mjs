/*
 * Тема проекта для выгрузки. Модуль из `theme` конфигурации (`storyframe.config.mjs`) отдаёт тему в формате
 * storyframe экспортом по умолчанию - объектом или функцией (можно асинхронной). Модуль грузится через
 * Vite SSR в корне проекта: так работают TypeScript, JSX и `import.meta.glob` исходников темы без отдельной
 * сборки. Для темы MUI формат строит адаптер `@ph2ph/storyframe/mui`.
 */

import path from 'node:path'
import * as v from 'valibot'

/** @typedef {import('../theme.d.mts').IStoryframeTheme} IStoryframeTheme */

const cssValue = v.union([v.string(), v.number()])
const code = v.optional(v.string())

const themeSchema = v.object({
  fonts: v.array(v.object({ family: v.string(), weights: v.array(v.number()) })),
  colors: v.array(
    v.pipe(
      v.object({
        id: v.string(),
        name: v.optional(v.string()),
        light: v.nullable(v.string()),
        dark: v.optional(v.nullable(v.string())),
        description: v.optional(v.string()),
        code,
        group: v.optional(v.string()),
        priority: v.optional(
          v.object({ fill: v.optional(v.number()), text: v.optional(v.number()), stroke: v.optional(v.number()) }),
        ),
        text: v.optional(v.boolean()),
      }),
      v.check(
        (color) => typeof color.light === 'string' || typeof color.dark === 'string',
        'нужно значение хотя бы одного режима',
      ),
    ),
  ),
  numbers: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      value: v.number(),
      scope: v.picklist(['radius', 'gap']),
      description: v.optional(v.string()),
      code,
      circle: v.optional(v.boolean()),
    }),
  ),
  typography: v.array(
    v.object({
      id: v.string(),
      name: v.optional(v.string()),
      fontFamily: v.string(),
      fontSize: v.number(),
      fontWeight: v.optional(cssValue),
      lineHeight: v.optional(cssValue),
      letterSpacing: v.optional(cssValue),
      textTransform: v.optional(v.string()),
      code,
    }),
  ),
  shadows: v.array(
    v.object({
      id: v.string(),
      name: v.optional(v.string()),
      light: v.string(),
      dark: v.optional(v.string()),
      code,
    }),
  ),
  canvas: v.optional(v.object({ light: v.optional(v.string()), dark: v.optional(v.string()) })),
  roles: v.optional(v.record(v.string(), v.string())),
})

/** Пустая тема: проект без модуля темы выгружает каталог без переменных и стилей. */
export const EMPTY_THEME = { fonts: [], colors: [], numbers: [], typography: [], shadows: [] }

/**
 * Проверяет тему схемой; нарушения - список «путь: сообщение».
 * @returns {string[]}
 */
export function validateTheme(theme) {
  const result = v.safeParse(themeSchema, theme)
  if (result.success) return []
  return result.issues.map((issue) => `${v.getDotPath(issue) ?? '(корень)'}: ${issue.message}`)
}

/**
 * Тема проекта из модуля `file` (путь от корня проекта); без модуля - пустая тема.
 * @param {string} root корень проекта
 * @param {string | null} file
 * @returns {Promise<IStoryframeTheme>}
 */
export async function loadTheme(root, file) {
  if (!file) return EMPTY_THEME
  const { createServer } = await import('vite')
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'error',
    appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  try {
    const module = await server.ssrLoadModule(path.resolve(root, file))
    const exported = module.default
    const theme = typeof exported === 'function' ? await exported() : exported
    const issues = validateTheme(theme)
    if (issues.length > 0) throw new Error(`тема ${file} не в формате storyframe:\n  ${issues.join('\n  ')}`)
    return theme
  } finally {
    await server.close()
  }
}
