/*
 * Runtime schema of the export for Figma (valibot), a mirror of the `capture/types.ts` types. The builder checks
 * `kit.json` with it before writing; the plugin checks only the schema version and the top level so as not to
 * drag the schema into its own bundle.
 */

import * as v from 'valibot'
import type { IKitBundle } from './capture/types.ts'

export const SCHEMA_VERSION = 2

const rgba = v.object({ r: v.number(), g: v.number(), b: v.number(), a: v.number() })

const colorRef = v.union([
  v.object({ token: v.string(), opacity: v.optional(v.number()) }),
  v.object({ light: rgba, dark: rgba, approx: v.optional(v.boolean()) }),
])

const paint = v.variant('kind', [
  v.object({ kind: v.literal('solid'), color: colorRef }),
  v.object({
    kind: v.literal('linear'),
    angle: v.number(),
    stops: v.array(v.object({ pos: v.number(), color: colorRef })),
  }),
])

const glow = v.object({
  cx: v.number(),
  cy: v.number(),
  rx: v.number(),
  ry: v.number(),
  stops: v.array(v.object({ pos: v.number(), color: rgba })),
})

const effect = v.variant('type', [
  v.object({
    type: v.picklist(['drop', 'inner']),
    color: colorRef,
    offset: v.object({ x: v.number(), y: v.number() }),
    blur: v.number(),
    spread: v.number(),
  }),
  v.object({ type: v.literal('backgroundBlur'), radius: v.number() }),
])

const layout = v.variant('mode', [
  v.object({ mode: v.literal('none') }),
  v.object({
    mode: v.picklist(['row', 'column']),
    gap: v.number(),
    padding: v.tuple([v.number(), v.number(), v.number(), v.number()]),
    justify: v.picklist(['min', 'center', 'max', 'space-between']),
    align: v.picklist(['min', 'center', 'max', 'baseline', 'stretch']),
    wrap: v.boolean(),
    crossGap: v.optional(v.number()),
  }),
])

const layerBase = {
  path: v.string(),
  name: v.string(),
  box: v.object({ x: v.number(), y: v.number(), w: v.number(), h: v.number() }),
  opacity: v.optional(v.number()),
  grow: v.optional(v.number()),
  alignSelf: v.optional(v.picklist(['min', 'center', 'max', 'stretch'])),
  absolute: v.optional(v.boolean()),
  minWidth: v.optional(v.number()),
  minHeight: v.optional(v.number()),
  warnings: v.optional(v.array(v.string())),
}

const textStyleValues = v.object({
  family: v.string(),
  weight: v.number(),
  sizePx: v.number(),
  lineHeightPx: v.number(),
  letterSpacingPx: v.number(),
  textCase: v.picklist(['original', 'upper', 'lower', 'title']),
  decoration: v.picklist(['none', 'underline', 'strike']),
  align: v.picklist(['left', 'center', 'right']),
})

// Tree recursion: `lazy` refers to the node schema declared below. The node type is not inferred through the
// recursion, and `TLayerNode` is narrower than the schema (a stroke `paint` of any kind), so the node is `unknown`.
const layerNode: v.GenericSchema<unknown> = v.lazy(() =>
  v.variant('type', [
    v.object({
      ...layerBase,
      type: v.literal('frame'),
      layout,
      sizing: v.optional(
        v.object({ w: v.picklist(['hug', 'fixed', 'fill']), h: v.picklist(['hug', 'fixed', 'fill']) }),
      ),
      fills: v.array(paint),
      stroke: v.optional(
        v.object({
          color: colorRef,
          weights: v.tuple([v.number(), v.number(), v.number(), v.number()]),
          dash: v.optional(v.array(v.number())),
          paint: v.optional(paint),
        }),
      ),
      radius: v.object({
        values: v.tuple([v.number(), v.number(), v.number(), v.number()]),
        token: v.optional(v.string()),
      }),
      effects: v.array(effect),
      clip: v.boolean(),
      children: v.array(layerNode),
    }),
    v.object({
      ...layerBase,
      type: v.literal('text'),
      text: v.string(),
      style: textStyleValues,
      typography: v.optional(v.string()),
      color: colorRef,
      autoResize: v.picklist(['both', 'height']),
      truncate: v.optional(v.boolean()),
      decorationColor: v.optional(colorRef),
      decorationThickness: v.optional(v.number()),
      decorationOffset: v.optional(v.number()),
    }),
    v.object({ ...layerBase, type: v.literal('svg'), asset: v.string(), color: v.optional(colorRef) }),
    v.object({
      ...layerBase,
      type: v.literal('instance'),
      component: v.string(),
      variant: v.record(v.string(), v.string()),
      overrides: v.object({ text: v.record(v.string(), v.string()) }),
    }),
  ]),
)

const code = v.optional(v.string())

export const bundleSchema = v.object({
  schema: v.literal(SCHEMA_VERSION),
  kit: v.object({ name: v.string(), version: v.string() }),
  builtAt: v.string(),
  fonts: v.array(v.object({ family: v.string(), weights: v.array(v.number()) })),
  tokens: v.object({
    colors: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        light: rgba,
        dark: rgba,
        description: v.string(),
        code,
        group: v.optional(v.string()),
        priority: v.optional(
          v.object({ fill: v.optional(v.number()), text: v.optional(v.number()), stroke: v.optional(v.number()) }),
        ),
        text: v.optional(v.boolean()),
      }),
    ),
    numbers: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        value: v.number(),
        scope: v.picklist(['radius', 'gap']),
        description: v.string(),
        code,
        circle: v.optional(v.boolean()),
      }),
    ),
    typography: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        family: v.string(),
        weight: v.number(),
        sizePx: v.number(),
        lineHeight: v.object({ unit: v.picklist(['percent', 'px']), value: v.number() }),
        letterSpacing: v.object({ unit: v.picklist(['percent', 'px']), value: v.number() }),
        textCase: v.picklist(['original', 'upper', 'lower', 'title']),
        code,
      }),
    ),
    effects: v.array(
      v.object({ id: v.string(), name: v.string(), light: v.array(effect), dark: v.array(effect), code }),
    ),
    canvas: v.optional(v.object({ light: v.array(glow), dark: v.array(glow) })),
    roles: v.optional(v.record(v.string(), v.string())),
  }),
  assets: v.object({ svg: v.record(v.string(), v.string()) }),
  components: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      description: v.string(),
      storyUrl: v.string(),
      axes: v.array(v.object({ name: v.string(), values: v.array(v.string()), description: v.optional(v.string()) })),
      textProps: v.array(v.object({ name: v.string(), path: v.string() })),
      variants: v.array(
        v.object({ variant: v.record(v.string(), v.string()), tree: layerNode, signature: v.array(v.string()) }),
      ),
      dependsOn: v.array(v.string()),
      collapsed: v.optional(
        v.array(
          v.object({
            axis: v.string(),
            values: v.array(v.string()),
            into: v.string(),
            description: v.optional(v.string()),
          }),
        ),
      ),
    }),
  ),
  stories: v.array(v.object({ id: v.string(), name: v.string(), storyUrl: v.string(), tree: layerNode })),
  pages: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      sections: v.array(
        v.object({
          id: v.string(),
          title: v.string(),
          items: v.array(
            v.object({
              id: v.string(),
              title: v.string(),
              description: v.string(),
              storyUrl: v.string(),
              component: v.optional(v.string()),
              stories: v.array(v.string()),
            }),
          ),
        }),
      ),
    }),
  ),
  layout: v.optional(v.object({ maxWidth: v.pipe(v.number(), v.minValue(320)) })),
  report: v.object({
    unboundColors: v.array(v.object({ light: rgba, dark: rgba, count: v.number(), where: v.array(v.string()) })),
    ambiguousColors: v.array(
      v.object({ light: rgba, dark: rgba, candidates: v.array(v.string()), chosen: v.string() }),
    ),
    outOfMatrix: v.array(v.string()),
  }),
})

/** An empty export without tokens and components, the base for tests and fixtures. */
export function emptyBundle(version = '0.0.0'): IKitBundle {
  return {
    schema: SCHEMA_VERSION,
    kit: { name: '@example/ui', version },
    builtAt: '1970-01-01T00:00:00.000Z',
    fonts: [],
    tokens: { colors: [], numbers: [], typography: [], effects: [] },
    assets: { svg: {} },
    components: [],
    stories: [],
    pages: [],
    report: { unboundColors: [], ambiguousColors: [], outOfMatrix: [] },
  }
}

/**
 * Validates the export against the schema. Returns the list of violations (empty means the export is valid);
 * the field path is dot-separated, as in the builder's messages.
 */
export function validateBundle(bundle: unknown): string[] {
  const result = v.safeParse(bundleSchema, bundle)
  if (result.success) return []
  return result.issues.map((issue) => {
    const where = issue.path?.map((segment) => String(segment.key)).join('.') || '<root>'
    return `${where}: ${issue.message}`
  })
}
