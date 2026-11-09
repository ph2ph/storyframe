import { describe, expect, it } from 'vitest'
import { coversTitle, layoutCatalog, normalizeConfig, placeTitle, resolvePages } from './config.mjs'
import config from './fixtures/config.mjs'

const story = (title, id = `${title.toLowerCase().replaceAll('/', '-')}--basic`) => ({ type: 'story', id, title })

describe('storyframe configuration', () => {
  it('a prefix covers a title by whole segments', () => {
    expect(coversTitle('Компоненты', 'Компоненты/DataTable')).toBe(true)
    expect(coversTitle('Компоненты', 'Компоненты MUI/Inputs/Button')).toBe(false)
    expect(coversTitle('Компоненты/Иконки', 'Компоненты/Иконки')).toBe(true)
  })

  it('without a configuration, a page per top-level section in catalog order', () => {
    const pages = resolvePages(normalizeConfig(), ['Гайдлайн/Палитра', 'Компоненты/A', 'Гайдлайн/Сетка', 'MCP/API'])
    expect(pages.map((page) => [page.id, page.name, page.include])).toEqual([
      ['Гайдлайн', 'Гайдлайн', ['Гайдлайн']],
      ['Компоненты', 'Компоненты', ['Компоненты']],
      ['MCP', 'MCP', ['MCP']],
    ])
  })

  it('longest prefix wins the title; the section is the catalog folder, without one it is the prefix section', () => {
    const pages = resolvePages(normalizeConfig(config), [])
    expect(placeTitle('Компоненты/Иконки', pages, config.exclude)).toMatchObject({
      page: { id: 'icons' },
      section: 'Иконки',
      item: 'Иконки',
    })
    // The kit's own components and the MUI catalog are merged onto one page in the configuration.
    expect(placeTitle('Компоненты/DataTable', pages, config.exclude)).toMatchObject({
      page: { id: 'components' },
      section: 'Компоненты',
      item: 'DataTable',
    })
    expect(placeTitle('Компоненты MUI/Data Display/Chip', pages, config.exclude)).toMatchObject({
      page: { id: 'components' },
      section: 'Data Display',
      item: 'Chip',
    })
    expect(placeTitle('MCP/Подключение', pages, config.exclude)).toBeNull()
    expect(placeTitle('Неизвестный/Раздел', pages, config.exclude)).toBeNull()
  })

  it('merging sections: two prefixes on one page', () => {
    const merged = normalizeConfig({
      pages: [{ id: 'components', name: 'Компоненты', include: ['Компоненты', 'Компоненты MUI'] }],
    })
    const layout = layoutCatalog(
      [story('Компоненты/DataTable'), story('Компоненты MUI/Inputs/Button'), story('Компоненты MUI/Inputs/Fab')],
      merged,
    )
    expect(layout).toHaveLength(1)
    expect(layout[0].sections.map((section) => [section.id, section.items.map((item) => item.name)])).toEqual([
      ['components:Компоненты', ['DataTable']],
      ['components:Inputs', ['Button', 'Fab']],
    ])
  })
})
