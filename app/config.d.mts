/** Ось набора по аргументу истории: значения - из `argTypes`, без исключённых. */
export interface IStoryframeArgAxis {
  name: string
  arg: string
  exclude?: string[]
}

/** Ось набора с явными значениями: аргументы истории или корень (`{ root: селектор }`) на каждое значение. */
export interface IStoryframeValuesAxis {
  name: string
  values: Record<string, Record<string, unknown>>
}

export type TStoryframeState = 'default' | 'hover' | 'focus' | 'disabled' | 'error'

/** Набор с осями, которые выгрузка сама из `argTypes` не выведет. */
export interface IStoryframeComponent {
  /** Имя набора в файле Figma и ключ пропусков, исключений. */
  id: string
  /** Группа и имя набора (`Inputs/Button`). */
  name: string
  storyId: string
  storyFile: string
  /** Селектор корня компонента в истории. */
  root: string
  axes: (IStoryframeArgAxis | IStoryframeValuesAxis)[]
  states: TStoryframeState[]
  /** Первый текстовый слой - свойство `Label` набора. */
  label?: boolean
  fixedArgs?: Record<string, unknown>
  dependsOn?: string[]
  /** Аргументы, которыми состояние показывается без взаимодействия (поле с `focused`) - для блока «Варианты». */
  stateArgs?: Partial<Record<TStoryframeState, Record<string, unknown>>>
}

/** Страница Figma: разделы каталога по префиксам заголовков историй. */
export interface IStoryframePage {
  /** Идентификатор страницы в файле: по нему плагин находит её при следующем запуске. По умолчанию - `name`. */
  id?: string
  name: string
  include: string[]
}

export interface IStoryframeConfig {
  /** Статическая сборка Storybook от корня проекта. По умолчанию `storybook-static`. */
  storybook?: string
  /** Папка выгрузки. По умолчанию `<storybook>/figma-data`. */
  out?: string
  /** Рабочая папка: сборки плагина, снимки сверки. По умолчанию `.storyframe`. */
  workDir?: string
  /** Модуль темы проекта: экспорт по умолчанию - тема в формате storyframe (адаптер `@ph2ph/storyframe/mui`). */
  theme?: string
  /** Адрес опубликованного Storybook для ссылок «История». */
  storyUrl?: string
  /** Страницы Figma. По умолчанию - страница на каждый раздел верхнего уровня каталога. */
  pages?: IStoryframePage[]
  /** Префиксы заголовков вне файла. */
  exclude?: string[]
  /** Компоненты, которые наборами не становятся: имя → причина. */
  skip?: Record<string, string>
  components?: IStoryframeComponent[]
  /** Наборы, которым разрешены непривязанные к токенам цвета: id → причина. */
  unboundExceptions?: Record<string, string>
  /** Раскладка файла: наибольшая ширина папки на странице (по умолчанию плагин берёт 1980). */
  layout?: { maxWidth: number }
}

export function defineConfig(config: IStoryframeConfig): IStoryframeConfig

export type {
  IStoryframeColor,
  IStoryframeFont,
  IStoryframeNumber,
  IStoryframeRoles,
  IStoryframeShadow,
  IStoryframeTheme,
  IStoryframeTypography,
} from './theme.d.mts'
