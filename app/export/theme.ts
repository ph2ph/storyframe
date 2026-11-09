/*
 * The project theme for the export. The module from the configuration's `theme` field (`storyframe.config.mjs`)
 * returns the theme in storyframe format as the default export, an object or a function (possibly async). The
 * module is loaded through Vite SSR in the project root: that way TypeScript, JSX and `import.meta.glob` in
 * the theme sources work without a separate build. For a MUI theme the format is built by the
 * `@ph2ph/storyframe/mui` adapter.
 */

import path from 'node:path'
import * as v from 'valibot'
import type { IStoryframeTheme } from '../theme.ts'

export type { IStoryframeTheme }

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

/** Empty theme: a project without a theme module exports the catalog without variables and styles. */
export const EMPTY_THEME: IStoryframeTheme = { fonts: [], colors: [], numbers: [], typography: [], shadows: [] }

/**
 * Validates the theme against the schema; violations are a list of "path: message" entries.
 */
export function validateTheme(theme: unknown): string[] {
  const result = v.safeParse(themeSchema, theme)
  if (result.success) return []
  return result.issues.map((issue) => `${v.getDotPath(issue) ?? '(корень)'}: ${issue.message}`)
}

/**
 * The project theme from the module `file` (path from the project root); without a module, the empty theme.
 * @param root project root
 */
export async function loadTheme(root: string, file: string | null): Promise<IStoryframeTheme> {
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
    const exported: unknown = module.default
    const theme: unknown = typeof exported === 'function' ? await (exported as () => unknown)() : exported
    const issues = validateTheme(theme)
    if (issues.length > 0) throw new Error(`тема ${file} не в формате storyframe:\n  ${issues.join('\n  ')}`)
    // The theme passed the schema check above.
    return theme as IStoryframeTheme
  } finally {
    await server.close()
  }
}
