/*
 * Раскладка каталога Storybook по страницам Figma и нормализация конфигурации storyframe - без модулей Node:
 * её же использует блок «Варианты» документации Storybook в браузере. Файл конфигурации читает `config.mjs`.
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
    // Пути - от корня проекта (папки, где лежит конфигурация).
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
    // Раскладку применяет плагин: без значения у него своё умолчание.
    layout: raw.layout ?? null,
  }
}

/** Сегменты заголовка истории Storybook (`Компоненты MUI/Inputs/Button`). */
export function titleSegments(title) {
  return title
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

/** Префикс покрывает заголовок по целым сегментам: `Компоненты` не покрывает `Компоненты MUI/…`. */
export function coversTitle(prefix, title) {
  const head = titleSegments(prefix)
  const segments = titleSegments(title)
  return head.length <= segments.length && head.every((segment, index) => segment === segments[index])
}

/**
 * Страницы выгрузки: из конфигурации, иначе по разделам верхнего уровня в порядке каталога.
 * @param {TConfig} config
 * @param {string[]} titles заголовки историй в порядке каталога
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
 * Место заголовка каталога в файле: страница с самым длинным подходящим префиксом, раздел (папка каталога
 * под префиксом) и пункт (компонент). Заголовок без папки попадает в раздел с именем самого префикса
 * (`Компоненты/DataTable` - в «Компоненты»). `null` - заголовок исключён или не попал ни на одну страницу.
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
  // Пункты прямо под префиксом (Компоненты/DataTable, Гайдлайн/Палитра) - одна папка с именем раздела каталога.
  const section = rest.length > 1 ? rest.slice(0, -1).join('/') : best.group
  return { page: best.page, section, item }
}

/**
 * Раскладка каталога: страницы → разделы → пункты в порядке каталога.
 * @param {{ title: string }[]} entries истории index.json
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
