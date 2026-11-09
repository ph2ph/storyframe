import { describe, expect, it } from 'vitest'
import { layoutCatalog, normalizeConfig } from './config.mjs'
import { buildPages, planJobs } from './plan.mjs'

const ENTRIES = [
  { type: 'story', id: 'guide-palette--main', title: 'Гайдлайн/Палитра', name: 'Main' },
  { type: 'story', id: 'guide-palette--brand', title: 'Гайдлайн/Палитра', name: 'Brand' },
  { type: 'story', id: 'mui-inputs-button--basic', title: 'Компоненты MUI/Inputs/Button', name: 'Базовая' },
  { type: 'story', id: 'mui-inputs-button--colors', title: 'Компоненты MUI/Inputs/Button', name: 'Цвета' },
  {
    type: 'story',
    id: 'mui-inputs-button--click',
    title: 'Компоненты MUI/Inputs/Button',
    name: 'Клик',
    tags: ['play-fn'],
  },
  { type: 'story', id: 'mui-utils-modal--basic', title: 'Компоненты MUI/Utils/Modal', name: 'Базовая' },
  { type: 'story', id: 'kit-drawer--basic', title: 'Компоненты/MiniDrawer', name: 'Базовая' },
  { type: 'story', id: 'kit-drawer--open', title: 'Компоненты/MiniDrawer', name: 'Открыта' },
]

const CONFIG = normalizeConfig({
  pages: [
    { id: 'guideline', name: 'Гайдлайн', include: ['Гайдлайн'] },
    { id: 'components', name: 'Компоненты', include: ['Компоненты'] },
    { id: 'components-mui', name: 'Компоненты MUI', include: ['Компоненты MUI'] },
  ],
  skip: { Modal: 'портал' },
  components: [
    { id: 'Button', name: 'Inputs/Button', storyId: 'mui-inputs-button--basic', root: '.btn', axes: [], states: [] },
    {
      id: 'DrawerItem',
      name: 'Navigation/DrawerItem',
      storyId: 'kit-drawer--basic',
      root: '.item',
      axes: [],
      states: [],
    },
  ],
})

describe('план выгрузки', () => {
  const plan = planJobs(layoutCatalog(ENTRIES, CONFIG), ENTRIES, CONFIG)
  const byTitle = Object.fromEntries(plan.map((entry) => [entry.item.title, entry]))

  it('пункт без записи конфигурации ищет набор сам, остальные истории - фреймами', () => {
    const palette = byTitle['Гайдлайн/Палитра']
    expect(palette.components).toEqual([
      expect.objectContaining({ id: 'Палитра', storyId: 'guide-palette--main', root: null, auto: true }),
    ])
    // Набор снят не с «Базовой» истории: сама история показывает больше набора и идёт ещё и фреймом.
    expect(palette.frames.map((entry) => entry.id)).toEqual(['guide-palette--main', 'guide-palette--brand'])
  })

  it('запись конфигурации задаёт набор пункта; история со сценарием play не выгружается', () => {
    const button = byTitle['Компоненты MUI/Inputs/Button']
    expect(button.components.map((entry) => [entry.id, entry.auto])).toEqual([['Button', false]])
    expect(button.frames.map((entry) => entry.id)).toEqual(['mui-inputs-button--colors'])
  })

  it('пропущенный компонент не даёт ни набора, ни фреймов', () => {
    expect(byTitle['Компоненты MUI/Utils/Modal']).toMatchObject({ components: [], frames: [] })
  })

  it('набор вложенного компонента: «Базовая» история пункта идёт и фреймом', () => {
    expect(byTitle['Компоненты/MiniDrawer'].components.map((entry) => entry.id)).toEqual(['DrawerItem'])
    expect(byTitle['Компоненты/MiniDrawer'].frames.map((entry) => entry.id)).toEqual([
      'kit-drawer--basic',
      'kit-drawer--open',
    ])
  })

  it('--only оставляет пункты по подстроке заголовка или id набора', () => {
    const only = planJobs(layoutCatalog(ENTRIES, CONFIG), ENTRIES, CONFIG, 'drawerit')
    expect(only.map((entry) => entry.item.title)).toEqual(['Компоненты/MiniDrawer'])
  })

  it('страницы из результатов: история без корня компонента идёт фреймом, пустые пункты отбрасываются', () => {
    const results = {
      components: new Map([['Button', { id: 'Button', storyUrl: 'http://stand/button' }]]),
      stories: new Map([
        ['guide-palette--main', {}],
        ['guide-palette--brand', {}],
        ['mui-inputs-button--colors', {}],
      ]),
      descriptions: new Map([['Компоненты MUI/Inputs/Button', 'Кнопка.']]),
      fallbacks: new Map([['Гайдлайн/Палитра', 'guide-palette--main']]),
    }
    const pages = buildPages(plan, results, (id) => `http://stand/${id}`)
    expect(pages.map((page) => page.id)).toEqual(['guideline', 'components-mui'])
    expect(pages[0].sections[0].items[0]).toEqual({
      id: 'Гайдлайн/Палитра',
      title: 'Палитра',
      description: '',
      storyUrl: 'http://stand/guide-palette--main',
      stories: ['guide-palette--main', 'guide-palette--brand'],
    })
    expect(pages[1].sections[0]).toMatchObject({
      id: 'components-mui:Inputs',
      title: 'Inputs',
      items: [
        {
          id: 'Компоненты MUI/Inputs/Button',
          title: 'Button',
          description: 'Кнопка.',
          component: 'Button',
          stories: ['mui-inputs-button--colors'],
        },
      ],
    })
  })
})
