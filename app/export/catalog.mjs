/*
 * Layout of the Storybook catalog across Figma pages and normalization of the storyframe configuration,
 * without Node modules: the Variants block of the Storybook docs uses it in the browser as well. The
 * configuration file is read by `config.mjs`.
 */

/**
 * @typedef {{ id?: string, name: string, include: string[] }} TPageConfig
 * @typedef {{ id: string, name: string, include: string[] }} TPage
 * @typedef {{
 *   storybook: string,
 *   out: string | null,
 *   workDir: string,
 *   theme: string | null,
 *   storyUrl: string | null,
 *   pages: TPageConfig[] | null,
 *   exclude: string[],
 *   skip: Record<string, string>,
 *   components: import('./registry.mjs').TRegistryEntry[],
 *   unboundExceptions: Record<string, string>,
 *   layout: { maxWidth: number } | null,
 * }} TConfig
 */

/** @returns {TConfig} */
export function normalizeConfig(raw = {}) {
  return {
    // Paths are relative to the project root (the folder holding the configuration).
    storybook: raw.storybook ?? 'storybook-static',
    out: raw.out ?? null,
    workDir: raw.workDir ?? '.storyframe',
    theme: raw.theme ?? null,
    storyUrl: raw.storyUrl ?? null,
    pages: raw.pages ?? null,
    exclude: raw.exclude ?? [],
    skip: raw.skip ?? {},
    components: raw.components ?? [],
    unboundExceptions: raw.unboundExceptions ?? {},
    // The layout is applied by the Figma plugin: without a value it uses its own default.
    layout: raw.layout ?? null,
  }
}

/** Segments of a Storybook story title (`Компоненты MUI/Inputs/Button`). */
export function titleSegments(title) {
  return title
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

/** A prefix covers a title by whole segments: `Компоненты` does not cover `Компоненты MUI/…`. */
export function coversTitle(prefix, title) {
  const head = titleSegments(prefix)
  const segments = titleSegments(title)
  return head.length <= segments.length && head.every((segment, index) => segment === segments[index])
}

/**
 * Pages of the export: from the configuration, otherwise one per top-level section in catalog order.
 * @param {TConfig} config
 * @param {string[]} titles story titles in catalog order
 * @returns {TPage[]}
 */
export function resolvePages(config, titles) {
  if (config.pages) {
    return config.pages.map((page) => ({ id: page.id ?? page.name, name: page.name, include: page.include }))
  }
  const tops = []
  for (const title of titles) {
    const top = titleSegments(title)[0]
    if (top && !tops.includes(top)) tops.push(top)
  }
  return tops.map((top) => ({ id: top, name: top, include: [top] }))
}

/**
 * Place of a catalog title in the file: the page with the longest matching prefix, the section (the catalog
 * folder under the prefix) and the item (the component). A title without a folder goes to the section named
 * after the prefix itself (`Компоненты/DataTable` goes to "Компоненты"). `null` means the title is excluded or
 * did not land on any page.
 * @param {string} title
 * @param {TPage[]} pages
 * @param {string[]} exclude
 * @returns {{ page: TPage, section: string, item: string } | null}
 */
export function placeTitle(title, pages, exclude = []) {
  if (exclude.some((prefix) => coversTitle(prefix, title))) return null
  let best = null
  for (const page of pages) {
    for (const prefix of page.include) {
      if (!coversTitle(prefix, title)) continue
      const depth = titleSegments(prefix).length
      if (!best || depth > best.depth) best = { page, depth, group: titleSegments(prefix).at(-1) }
    }
  }
  if (!best) return null
  const segments = titleSegments(title)
  const rest = segments.slice(best.depth)
  const item = rest.at(-1) ?? segments.at(-1)
  // Items directly under the prefix (Компоненты/DataTable, Гайдлайн/Палитра) share one folder named after the
  // catalog section.
  const section = rest.length > 1 ? rest.slice(0, -1).join('/') : best.group
  return { page: best.page, section, item }
}

/**
 * Catalog layout: pages → sections → items in catalog order.
 * @param {{ title: string }[]} entries stories from index.json
 * @returns {{ page: TPage, sections: { id: string, title: string, items: { title: string, name: string }[] }[] }[]}
 */
export function layoutCatalog(entries, config) {
  const titles = []
  for (const entry of entries) if (!titles.includes(entry.title)) titles.push(entry.title)
  const pages = resolvePages(config, titles)
  const result = pages.map((page) => ({ page, sections: [] }))
  for (const title of titles) {
    const place = placeTitle(title, pages, config.exclude)
    if (!place) continue
    const target = result.find((entry) => entry.page.id === place.page.id)
    const sectionId = `${place.page.id}:${place.section}`
    let section = target.sections.find((candidate) => candidate.id === sectionId)
    if (!section) {
      section = { id: sectionId, title: place.section, items: [] }
      target.sections.push(section)
    }
    section.items.push({ title, name: place.item })
  }
  return result.filter((entry) => entry.sections.length > 0)
}
