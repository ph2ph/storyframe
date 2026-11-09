/*
 * Export plan over the catalog: what to capture for each item (component sets and stories as frames) and how
 * to assemble Figma pages from the capture results. It needs no browser, so tests check it.
 */

import { titleSegments } from './config.mjs'
import { pickStory } from './discover.mjs'

/**
 * Export jobs over the catalog: per item, the component sets from the configuration or a discovered set (if the
 * story has a root by class) and stories as frames. A component skipped in the configuration yields neither a
 * set nor frames.
 */
export function planJobs(layout, storyEntries, config, only = null) {
  const titleOf = new Map(storyEntries.map((entry) => [entry.id, entry.title]))
  const items = []
  // Discovered sets do not take the ids of configuration sets: instances are looked up by id.
  const usedIds = new Set(config.components.map((entry) => entry.id))
  for (const { page, sections } of layout) {
    for (const section of sections) {
      for (const item of section.items) {
        const matches = (text) => text.toLowerCase().includes(only.toLowerCase())
        const id = titleSegments(item.title).at(-1)
        const stories = storyEntries.filter((entry) => entry.title === item.title)
        const own = config.components.filter((entry) => titleOf.get(entry.storyId) === item.title)
        if (only && !matches(item.title) && !own.some((entry) => matches(entry.id))) continue
        const skipped = id in config.skip
        const components = own.map((entry) => ({ ...entry, auto: false }))
        if (components.length === 0 && !skipped && stories.length > 0) {
          let unique = id
          for (let n = 2; usedIds.has(unique); n += 1) unique = `${id}${n}`
          const story = pickStory(stories)
          usedIds.add(unique)
          components.push({
            id: unique,
            name: section.title === item.name ? unique : `${section.title}/${unique}`,
            storyId: story.id,
            root: null,
            axes: [],
            states: ['default'],
            auto: true,
          })
        }
        // The "Basic" story of the item's own component set is the set itself. A story shows more than the set
        // when the set is captured from a nested component (MiniDrawerItem in MiniDrawer) or from a composite
        // story without a "Basic" one (ListItemIcon "In a button and in a row"): then it also goes as a frame.
        const bases = new Set(
          components
            .filter((entry) => entry.id === id && entry.storyId.endsWith('--basic'))
            .map((entry) => entry.storyId),
        )
        // Stories with a `play` scenario repeat the basic one and change its state with clicks: they do not go
        // into the file.
        const frames = skipped
          ? []
          : stories.filter((entry) => !bases.has(entry.id) && !(entry.tags ?? []).includes('play-fn'))
        items.push({ page, section, item, components, frames })
      }
    }
  }
  return items
}

/** Export pages from the plan and capture results: empty items and sections are left out. */
export function buildPages(plan, results, storyUrl) {
  const pages = []
  for (const planned of plan) {
    const component = planned.components.map((entry) => results.components.get(entry.id)).find(Boolean)
    const fallback = results.fallbacks.get(planned.item.title)
    const storyIds = [...new Set([...(fallback ? [fallback] : []), ...planned.frames.map((story) => story.id)])].filter(
      (id) => results.stories.has(id),
    )
    if (!component && storyIds.length === 0) continue
    // The item's other sets (several configuration entries for one story) become separate items.
    const extra = planned.components
      .map((entry) => results.components.get(entry.id))
      .filter((candidate) => candidate && candidate !== component)
    let page = pages.find((candidate) => candidate.id === planned.page.id)
    if (!page) {
      page = { id: planned.page.id, name: planned.page.name, sections: [] }
      pages.push(page)
    }
    let section = page.sections.find((candidate) => candidate.id === planned.section.id)
    if (!section) {
      section = { id: planned.section.id, title: planned.section.title, items: [] }
      page.sections.push(section)
    }
    const firstStory = component?.storyUrl || (storyIds[0] ? storyUrl(storyIds[0]) : '')
    section.items.push({
      id: planned.item.title,
      title: planned.item.name,
      description: results.descriptions.get(planned.item.title) ?? '',
      storyUrl: firstStory,
      ...(component ? { component: component.id } : {}),
      stories: storyIds,
    })
    for (const other of extra) {
      section.items.push({
        id: `${planned.item.title}#${other.id}`,
        title: other.id,
        description: '',
        storyUrl: other.storyUrl,
        component: other.id,
        stories: [],
      })
    }
  }
  return pages
}
