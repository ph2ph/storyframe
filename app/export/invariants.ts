/*
 * Invariants of the export for Figma: a violation fails the build (exit code 1), as with the MCP set. Checked
 * are the schema, size, fonts, assets, matrices and unbound colors of registry components.
 */

import type { IFontSpec, IKitBundle, TLayerNode } from './capture/types.ts'
import { validateBundle } from './schema.ts'

/** Where the check writes what it found: a violation fails the build, a warning does not. */
interface ICheckReport {
  violation(text: string): void
  warning(text: string): void
}

// The icon catalog and component stories are tens of megabytes of JSON; the plugin reads it from a ZIP
// (a few megabytes).
export const MAX_BUNDLE_BYTES = 48 * 1024 * 1024

export function* walkTree(node: TLayerNode): Generator<TLayerNode, void, undefined> {
  yield node
  if (node.type === 'frame') for (const child of node.children) yield* walkTree(child)
}

function fontAllowed(fonts: IFontSpec[], family: string, weight: number): boolean {
  return fonts.some((font) => font.family === family && font.weights.includes(weight))
}

/**
 * @param bundle the export
 * @param options `strictIds`:
 *   component sets from the configuration, whose unbound colors are a violation; for stories and component sets
 *   discovered in the catalog they are a warning
 */
export function checkBundle(
  bundle: IKitBundle,
  report: ICheckReport,
  {
    unboundExceptions = {},
    bytes,
    strictIds = [],
  }: { unboundExceptions?: Record<string, string>; bytes: number; strictIds?: string[] },
): void {
  for (const issue of validateBundle(bundle)) report.violation(`export schema: ${issue}`)
  if (bytes > MAX_BUNDLE_BYTES) report.violation(`kit.json weighs ${bytes} bytes, limit ${MAX_BUNDLE_BYTES}`)

  const used = new Set<string>()
  const foreignFonts = new Map<string, number>()
  const trees = [
    ...bundle.components.flatMap((component) =>
      component.variants.map((variant) => ({
        where: `${component.id} ${variantLabel(variant.variant)}`,
        tree: variant.tree,
      })),
    ),
    ...bundle.stories.map((story) => ({ where: story.id, tree: story.tree })),
  ]
  for (const { where, tree } of trees) {
    for (const node of walkTree(tree)) {
      if (node.type === 'text' && !fontAllowed(bundle.fonts, node.style.family, node.style.weight)) {
        const component = where.split(' ')[0]
        const font = `${node.style.family} ${node.style.weight}`
        if (strictIds.includes(component))
          report.violation(`${where} ${node.path}: font ${font} is not from the theme fonts`)
        else foreignFonts.set(`${component}|${font}`, (foreignFonts.get(`${component}|${font}`) ?? 0) + 1)
      }
      if (node.type === 'svg') {
        used.add(node.asset)
        if (!(node.asset in bundle.assets.svg)) report.violation(`${where} ${node.path}: no asset ${node.asset}`)
      }
    }
  }
  for (const key of Object.keys(bundle.assets.svg)) {
    if (!used.has(key)) report.violation(`asset ${key} is unused`)
  }
  // Component sets from the catalog without a registry entry may contain text in a system font (ButtonBase
  // without typography): the plugin takes it from Figma, and for the catalog it is a reason to fix the story.
  for (const [key, count] of foreignFonts) {
    const [component, font] = key.split('|')
    report.warning(`${component}: ${count} texts in font ${font} not from the theme fonts (set not from the config)`)
  }

  for (const component of bundle.components) {
    const expected = component.axes.reduce((product, axis) => product * axis.values.length, 1)
    if (component.variants.length !== expected) {
      report.violation(`${component.id}: ${component.variants.length} variants for an axes product of ${expected}`)
    }
  }
  const components = new Set(bundle.components.map((component) => component.id))
  const stories = new Set(bundle.stories.map((story) => story.id))
  for (const page of bundle.pages) {
    for (const section of page.sections) {
      for (const item of section.items) {
        if (item.component && !components.has(item.component))
          report.violation(`${page.name} / ${item.id}: no set ${item.component}`)
        for (const id of item.stories)
          if (!stories.has(id)) report.violation(`${page.name} / ${item.id}: no story ${id}`)
      }
    }
  }

  const unboundByComponent = new Map<string, number>()
  for (const entry of bundle.report.unboundColors) {
    for (const where of entry.where) {
      const component = where.split(' ')[0]
      // Stories as frames are examples of compositions, not a component matrix: the strict check skips them.
      if (!components.has(component)) continue
      unboundByComponent.set(component, (unboundByComponent.get(component) ?? 0) + 1)
    }
  }
  for (const [component, count] of unboundByComponent) {
    const reason = unboundExceptions[component]
    if (reason) report.warning(`${component}: ${count} unbound colors (allowed: ${reason})`)
    else if (!strictIds.includes(component))
      report.warning(`${component}: ${count} unbound colors (catalog set without a config entry)`)
    else
      report.violation(`${component}: ${count} unbound colors - add a token to the theme or an exception with a reason`)
  }
}

export function variantLabel(variant: Record<string, string>): string {
  return Object.entries(variant)
    .map(([axis, value]) => `${axis}=${value}`)
    .join(', ')
}
