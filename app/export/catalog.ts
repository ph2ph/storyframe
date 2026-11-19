/*
 * Layout of the Storybook catalog across Figma pages and normalization of the storyframe configuration,
 * without Node modules: the Variants block of the Storybook docs uses it in the browser as well. The
 * configuration file is read by `config.mjs`.
 */

import type { IStoryframeConfig } from '../config.ts'
import type { TRegistryEntry } from './registry.ts'

export type TPageConfig = { id?: string; name: string; include: string[] }
export type TPage = { id: string; name: string; include: string[] }
export type TConfig = {
  storybook: string
  out: string | null
  workDir: string
  theme: string | null
  storyUrl: string | null
  pages: TPageConfig[] | null
  exclude: string[]
  skip: Record<string, string>
  components: TRegistryEntry[]
  unboundExceptions: Record<string, string>
  layout: { maxWidth: number } | null
}

/** Place of a catalog title in the file: the page, the section (catalog folder) and the item (component). */
export type TPlace = { page: TPage; section: string; item: string }
export type TCatalogItem = { title: string; name: string }
export type TCatalogSection = { id: string; title: string; items: TCatalogItem[] }
export type TCatalogPage = { page: TPage; sections: TCatalogSection[] }

export function normalizeConfig(raw: IStoryframeConfig = {}): TConfig {
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

/** Segments of a Storybook story title (`Components MUI/Inputs/Button`). */
export function titleSegments(title: string): string[] {
  return title
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
}

/** A prefix covers a title by whole segments: `Components` does not cover `Components MUI/…`. */
export function coversTitle(prefix: string, title: string): boolean {
  const head = titleSegments(prefix)
  const segments = titleSegments(title)
  return head.length <= segments.length && head.every((segment, index) => segment === segments[index])
}

/**
 * Pages of the export: from the configuration, otherwise one per top-level section in catalog order.
 * @param titles story titles in catalog order
 */
export function resolvePages(config: TConfig, titles: string[]): TPage[] {
  if (config.pages) {
    return config.pages.map((page) => ({ id: page.id ?? page.name, name: page.name, include: page.include }))
  }
  const tops: string[] = []
  for (const title of titles) {
    const top = titleSegments(title)[0]
    if (top && !tops.includes(top)) tops.push(top)
  }
  return tops.map((top) => ({ id: top, name: top, include: [top] }))
}

/**
 * Place of a catalog title in the file: the page with the longest matching prefix, the section (the catalog
 * folder under the prefix) and the item (the component). A title without a folder goes to the section named
 * after the prefix itself (`Components/DataTable` goes to "Components"). `null` means the title is excluded or
 * did not land on any page.
 */
export function placeTitle(title: string, pages: TPage[], exclude: string[] = []): TPlace | null {
  if (exclude.some((prefix) => coversTitle(prefix, title))) return null
  let best: { page: TPage; depth: number; group: string } | null = null
  for (const page of pages) {
    for (const prefix of page.include) {
      if (!coversTitle(prefix, title)) continue
      const depth = titleSegments(prefix).length
      // A covering prefix is a non-empty title prefix: it has a last segment.
      if (!best || depth > best.depth) best = { page, depth, group: titleSegments(prefix).at(-1) as string }
    }
  }
  if (!best) return null
  const segments = titleSegments(title)
  const rest = segments.slice(best.depth)
  // The title is covered by a non-empty prefix: it has a last segment.
  const item = (rest.at(-1) ?? segments.at(-1)) as string
  // Items directly under the prefix (Components/DataTable, Guideline/Palette) share one folder named after the
  // catalog section.
  const section = rest.length > 1 ? rest.slice(0, -1).join('/') : best.group
  return { page: best.page, section, item }
}

/**
 * Catalog layout: pages → sections → items in catalog order.
 * @param entries stories from index.json
 */
export function layoutCatalog(entries: { title: string }[], config: TConfig): TCatalogPage[] {
  const titles: string[] = []
  for (const entry of entries) if (!titles.includes(entry.title)) titles.push(entry.title)
  const pages = resolvePages(config, titles)
  const result: TCatalogPage[] = pages.map((page) => ({ page, sections: [] }))
  for (const title of titles) {
    const place = placeTitle(title, pages, config.exclude)
    if (!place) continue
    // `place.page` is one of `pages`, and `result` has an entry for each of them.
    const target = result.find((entry) => entry.page.id === place.page.id)!
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
