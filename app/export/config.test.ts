import { describe, expect, it } from 'vitest'
import { coversTitle, layoutCatalog, normalizeConfig, placeTitle, resolvePages } from './config.ts'
import config from './fixtures/config.ts'

const story = (title: string, id = `${title.toLowerCase().replaceAll('/', '-')}--basic`) => ({
  type: 'story',
  id,
  title,
})

describe('storyframe configuration', () => {
  it('a prefix covers a title by whole segments', () => {
    expect(coversTitle('Components', 'Components/DataTable')).toBe(true)
    expect(coversTitle('Components', 'Components MUI/Inputs/Button')).toBe(false)
    expect(coversTitle('Components/Icons', 'Components/Icons')).toBe(true)
  })

  it('without a configuration, a page per top-level section in catalog order', () => {
    const pages = resolvePages(normalizeConfig(), ['Guideline/Palette', 'Components/A', 'Guideline/Grid', 'MCP/API'])
    expect(pages.map((page) => [page.id, page.name, page.include])).toEqual([
      ['Guideline', 'Guideline', ['Guideline']],
      ['Components', 'Components', ['Components']],
      ['MCP', 'MCP', ['MCP']],
    ])
  })

  it('longest prefix wins the title; the section is the catalog folder, without one it is the prefix section', () => {
    const pages = resolvePages(normalizeConfig(config), [])
    expect(placeTitle('Components/Icons', pages, config.exclude)).toMatchObject({
      page: { id: 'icons' },
      section: 'Icons',
      item: 'Icons',
    })
    // The kit's own components and the MUI catalog are merged onto one page in the configuration.
    expect(placeTitle('Components/DataTable', pages, config.exclude)).toMatchObject({
      page: { id: 'components' },
      section: 'Components',
      item: 'DataTable',
    })
    expect(placeTitle('Components MUI/Data Display/Chip', pages, config.exclude)).toMatchObject({
      page: { id: 'components' },
      section: 'Data Display',
      item: 'Chip',
    })
    expect(placeTitle('MCP/Connection', pages, config.exclude)).toBeNull()
    expect(placeTitle('Unknown/Section', pages, config.exclude)).toBeNull()
  })

  it('merging sections: two prefixes on one page', () => {
    const merged = normalizeConfig({
      pages: [{ id: 'components', name: 'Components', include: ['Components', 'Components MUI'] }],
    })
    const layout = layoutCatalog(
      [story('Components/DataTable'), story('Components MUI/Inputs/Button'), story('Components MUI/Inputs/Fab')],
      merged,
    )
    expect(layout).toHaveLength(1)
    expect(layout[0].sections.map((section) => [section.id, section.items.map((item) => item.name)])).toEqual([
      ['components:Components', ['DataTable']],
      ['components:Inputs', ['Button', 'Fab']],
    ])
  })
})
