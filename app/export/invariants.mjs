/*
 * Invariants of the export for Figma: a violation fails the build (exit code 1), as with the MCP set. Checked
 * are the schema, size, fonts, assets, matrices and unbound colors of registry components.
 */

import { validateBundle } from './schema.mjs'

// The icon catalog and component stories are tens of megabytes of JSON; the plugin reads it from a ZIP
// (a few megabytes).
export const MAX_BUNDLE_BYTES = 48 * 1024 * 1024

export function* walkTree(node) {
  yield node
  if (node.type === 'frame') for (const child of node.children) yield* walkTree(child)
}

function fontAllowed(fonts, family, weight) {
  return fonts.some((font) => font.family === family && font.weights.includes(weight))
}

/**
 * @param {object} bundle the export
 * @param {{ violation(text: string): void, warning(text: string): void }} report
 * @param {{ unboundExceptions?: Record<string, string>, bytes: number, strictIds?: string[] }} options `strictIds`:
 *   component sets from the configuration, whose unbound colors are a violation; for stories and component sets
 *   discovered in the catalog they are a warning
 */
export function checkBundle(bundle, report, { unboundExceptions = {}, bytes, strictIds = [] }) {
  for (const issue of validateBundle(bundle)) report.violation(`схема выгрузки: ${issue}`)
  if (bytes > MAX_BUNDLE_BYTES) report.violation(`kit.json весит ${bytes} байт, предел ${MAX_BUNDLE_BYTES}`)

  const used = new Set()
  const foreignFonts = new Map()
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
        if (strictIds.includes(component)) report.violation(`${where} ${node.path}: шрифт ${font} не из шрифтов темы`)
        else foreignFonts.set(`${component}|${font}`, (foreignFonts.get(`${component}|${font}`) ?? 0) + 1)
      }
      if (node.type === 'svg') {
        used.add(node.asset)
        if (!(node.asset in bundle.assets.svg)) report.violation(`${where} ${node.path}: нет ассета ${node.asset}`)
      }
    }
  }
  for (const key of Object.keys(bundle.assets.svg)) {
    if (!used.has(key)) report.violation(`ассет ${key} не используется`)
  }
  // Component sets from the catalog without a registry entry may contain text in a system font (ButtonBase
  // without typography): the plugin takes it from Figma, and for the catalog it is a reason to fix the story.
  for (const [key, count] of foreignFonts) {
    const [component, font] = key.split('|')
    report.warning(`${component}: ${count} текстов шрифтом ${font} не из шрифтов темы (набор не из конфигурации)`)
  }

  for (const component of bundle.components) {
    const expected = component.axes.reduce((product, axis) => product * axis.values.length, 1)
    if (component.variants.length !== expected) {
      report.violation(`${component.id}: ${component.variants.length} вариантов при произведении осей ${expected}`)
    }
  }
  const components = new Set(bundle.components.map((component) => component.id))
  const stories = new Set(bundle.stories.map((story) => story.id))
  for (const page of bundle.pages) {
    for (const section of page.sections) {
      for (const item of section.items) {
        if (item.component && !components.has(item.component))
          report.violation(`${page.name} / ${item.id}: нет набора ${item.component}`)
        for (const id of item.stories)
          if (!stories.has(id)) report.violation(`${page.name} / ${item.id}: нет истории ${id}`)
      }
    }
  }

  const unboundByComponent = new Map()
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
    if (reason) report.warning(`${component}: ${count} непривязанных цветов (допущено: ${reason})`)
    else if (!strictIds.includes(component))
      report.warning(`${component}: ${count} непривязанных цветов (набор из каталога без записи в конфигурации)`)
    else
      report.violation(`${component}: ${count} непривязанных цветов - добавьте токен в тему или исключение с причиной`)
  }
}

export function variantLabel(variant) {
  return Object.entries(variant)
    .map(([axis, value]) => `${axis}=${value}`)
    .join(', ')
}
