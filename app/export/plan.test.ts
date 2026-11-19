import { describe, expect, it } from 'vitest'
import { layoutCatalog, normalizeConfig } from './config.ts'
import { buildPages, planJobs } from './plan.ts'

const ENTRIES = [
  { type: 'story', id: 'guide-palette--main', title: 'Guideline/Palette', name: 'Main' },
  { type: 'story', id: 'guide-palette--brand', title: 'Guideline/Palette', name: 'Brand' },
  { type: 'story', id: 'mui-inputs-button--basic', title: 'Components MUI/Inputs/Button', name: 'Basic' },
  { type: 'story', id: 'mui-inputs-button--colors', title: 'Components MUI/Inputs/Button', name: 'Colors' },
  {
    type: 'story',
    id: 'mui-inputs-button--click',
    title: 'Components MUI/Inputs/Button',
    name: 'Click',
    tags: ['play-fn'],
  },
  { type: 'story', id: 'mui-utils-modal--basic', title: 'Components MUI/Utils/Modal', name: 'Basic' },
  { type: 'story', id: 'kit-drawer--basic', title: 'Components/MiniDrawer', name: 'Basic' },
  { type: 'story', id: 'kit-drawer--open', title: 'Components/MiniDrawer', name: 'Open' },
]

const CONFIG = normalizeConfig({
  pages: [
    { id: 'guideline', name: 'Guideline', include: ['Guideline'] },
    { id: 'components', name: 'Components', include: ['Components'] },
    { id: 'components-mui', name: 'Components MUI', include: ['Components MUI'] },
  ],
  skip: { Modal: 'portal' },
  components: [
    {
      id: 'Button',
      name: 'Inputs/Button',
      storyId: 'mui-inputs-button--basic',
      storyFile: 'src/Button.stories.tsx',
      root: '.btn',
      axes: [],
      states: [],
    },
    {
      id: 'DrawerItem',
      name: 'Navigation/DrawerItem',
      storyId: 'kit-drawer--basic',
      storyFile: 'src/MiniDrawer.stories.tsx',
      root: '.item',
      axes: [],
      states: [],
    },
  ],
})

describe('export plan', () => {
  const plan = planJobs(layoutCatalog(ENTRIES, CONFIG), ENTRIES, CONFIG)
  const byTitle = Object.fromEntries(plan.map((entry) => [entry.item.title, entry]))

  it('an item without a configuration entry discovers its set itself, the other stories go as frames', () => {
    const palette = byTitle['Guideline/Palette']
    expect(palette.components).toEqual([
      expect.objectContaining({ id: 'Palette', storyId: 'guide-palette--main', root: null, auto: true }),
    ])
    // The set is not captured from the "Basic" story: the story shows more than the set and also goes as a frame.
    expect(palette.frames.map((entry) => entry.id)).toEqual(['guide-palette--main', 'guide-palette--brand'])
  })

  it('a configuration entry defines the item set; a story with a play scenario is not exported', () => {
    const button = byTitle['Components MUI/Inputs/Button']
    expect(button.components.map((entry) => [entry.id, entry.auto])).toEqual([['Button', false]])
    expect(button.frames.map((entry) => entry.id)).toEqual(['mui-inputs-button--colors'])
  })

  it('a skipped component yields neither a set nor frames', () => {
    expect(byTitle['Components MUI/Utils/Modal']).toMatchObject({ components: [], frames: [] })
  })

  it('a nested component set: the item "Basic" story also goes as a frame', () => {
    expect(byTitle['Components/MiniDrawer'].components.map((entry) => entry.id)).toEqual(['DrawerItem'])
    expect(byTitle['Components/MiniDrawer'].frames.map((entry) => entry.id)).toEqual([
      'kit-drawer--basic',
      'kit-drawer--open',
    ])
  })

  it('--only keeps items by a substring of the title or set id', () => {
    const only = planJobs(layoutCatalog(ENTRIES, CONFIG), ENTRIES, CONFIG, 'drawerit')
    expect(only.map((entry) => entry.item.title)).toEqual(['Components/MiniDrawer'])
  })

  it('pages from results: a story without a component root goes as a frame, empty items are dropped', () => {
    const results = {
      components: new Map([['Button', { id: 'Button', storyUrl: 'http://stand/button' }]]),
      stories: new Map([
        ['guide-palette--main', {}],
        ['guide-palette--brand', {}],
        ['mui-inputs-button--colors', {}],
      ]),
      descriptions: new Map([['Components MUI/Inputs/Button', 'Button.']]),
      fallbacks: new Map([['Guideline/Palette', 'guide-palette--main']]),
    }
    const pages = buildPages(plan, results, (id) => `http://stand/${id}`)
    expect(pages.map((page) => page.id)).toEqual(['guideline', 'components-mui'])
    expect(pages[0].sections[0].items[0]).toEqual({
      id: 'Guideline/Palette',
      title: 'Palette',
      description: '',
      storyUrl: 'http://stand/guide-palette--main',
      stories: ['guide-palette--main', 'guide-palette--brand'],
    })
    expect(pages[1].sections[0]).toMatchObject({
      id: 'components-mui:Inputs',
      title: 'Inputs',
      items: [
        {
          id: 'Components MUI/Inputs/Button',
          title: 'Button',
          description: 'Button.',
          component: 'Button',
          stories: ['mui-inputs-button--colors'],
        },
      ],
    })
  })
})
