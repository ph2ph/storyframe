/*
 * План выгрузки по каталогу: что снимать на каждый пункт (наборы и истории фреймами) и как из результатов
 * съёмки собрать страницы Figma. Без браузера - его проверяют тесты.
 */

import { titleSegments } from './config.mjs'
import { pickStory } from './discover.mjs'

/**
 * Работы выгрузки по каталогу: на пункт - наборы из конфигурации или найденный набор (если у истории есть
 * корень по классу) и истории фреймами. Пропущенный в конфигурации компонент не даёт ни набора, ни фреймов.
 */
export function planJobs(layout, storyEntries, config, only = null) {
  const titleOf = new Map(storyEntries.map((entry) => [entry.id, entry.title]))
  const items = []
  // Найденные наборы не забирают id наборов конфигурации: экземпляры ищутся по id.
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
        // «Базовая» история набора самого компонента пункта - это и есть набор. История показывает больше
        // набора, если набор снят с вложенного компонента (MiniDrawerItem в MiniDrawer) или с составной
        // истории без «Базовой» (ListItemIcon «В кнопке и в строке»): тогда она идёт ещё и фреймом.
        const bases = new Set(
          components
            .filter((entry) => entry.id === id && entry.storyId.endsWith('--basic'))
            .map((entry) => entry.storyId),
        )
        // Истории со сценарием `play` повторяют базовую и меняют её состояние кликами - в файл не идут.
        const frames = skipped
          ? []
          : stories.filter((entry) => !bases.has(entry.id) && !(entry.tags ?? []).includes('play-fn'))
        items.push({ page, section, item, components, frames })
      }
    }
  }
  return items
}

/** Страницы выгрузки из плана и результатов съёмки: пустые пункты и разделы не попадают. */
export function buildPages(plan, results, storyUrl) {
  const pages = []
  for (const planned of plan) {
    const component = planned.components.map((entry) => results.components.get(entry.id)).find(Boolean)
    const fallback = results.fallbacks.get(planned.item.title)
    const storyIds = [...new Set([...(fallback ? [fallback] : []), ...planned.frames.map((story) => story.id)])].filter(
      (id) => results.stories.has(id),
    )
    if (!component && storyIds.length === 0) continue
    // Остальные наборы пункта (несколько записей конфигурации на одну историю) - отдельными пунктами.
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
