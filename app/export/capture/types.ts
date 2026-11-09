/*
 * Формат выгрузки для Figma (`kit.json` в папке выгрузки). Типы общие для конвертера DOM → слои
 * (собирается esbuild и работает в странице каталога), сборщика выгрузки и плагина Figma. Рантайм-проверка
 * выгрузки в сборщике - `export/schema.mjs`, повторяет эти типы.
 */

/**
 * Цвет-метка в разметке SVG: им записан `currentColor` (цвет текста элемента). Плагин перекрашивает только
 * такие заливки и обводки в цвет узла; остальные цвета SVG (многоцветные иконки, цифра в кружке) остаются.
 */
export const SVG_TINT = '#fe01fe'

/** Псевдоселектор корня: содержимое истории без обёрток (`capture/index.ts`). */
export const CONTENT_ROOT = '@content'

export const SCHEMA_VERSION = 2

/** Цвет в единицах Figma: каналы и альфа 0–1. */
export interface IRgba {
  r: number
  g: number
  b: number
  a: number
}

/** Ссылка на цвет: токен палитры (адрес `palette.…`) либо литералы обоих режимов. */
export type TColorRef = { token: string; opacity?: number } | { light: IRgba; dark: IRgba; approx?: boolean }

export type TPaint =
  | { kind: 'solid'; color: TColorRef }
  | { kind: 'linear'; angle: number; stops: { pos: number; color: TColorRef }[] }

export type TEffect =
  | { type: 'drop' | 'inner'; color: TColorRef; offset: { x: number; y: number }; blur: number; spread: number }
  | { type: 'backgroundBlur'; radius: number }

export type TAlign = 'min' | 'center' | 'max'

export type TLayout =
  | { mode: 'none' }
  | {
      mode: 'row' | 'column'
      gap: number
      padding: [number, number, number, number]
      justify: TAlign | 'space-between'
      align: TAlign | 'baseline' | 'stretch'
      wrap: boolean
      /** Промежуток между строками переносимого ряда (`counterAxisSpacing`); без него - `gap`. */
      crossGap?: number
    }

export interface IBox {
  x: number
  y: number
  w: number
  h: number
}

interface ILayerBase {
  /** Путь узла в дереве образца: индексы детей через `/`; по нему плагин сверяет слои при обновлении. */
  path: string
  name: string
  box: IBox
  opacity?: number
  grow?: number
  alignSelf?: TAlign | 'stretch'
  absolute?: boolean
  minWidth?: number
  minHeight?: number
  warnings?: string[]
  /** Семантические классы элемента: нужны сборщику для поиска экземпляров, в выгрузку не пишутся. */
  classes?: string[]
}

export interface IStroke {
  color: TColorRef
  weights: [number, number, number, number]
  dash?: number[]
  /** Градиент `border-image`: в Figma - градиентная обводка; `color` - запасной цвет из середины. */
  paint?: Extract<TPaint, { kind: 'linear' }>
}

export type TSizing = 'hug' | 'fixed' | 'fill'

export interface IFrameNode extends ILayerBase {
  type: 'frame'
  layout: TLayout
  /** Как фрейм ведёт себя по ширине и высоте: по содержимому, фиксированно или на всю ширину родителя. */
  sizing?: { w: TSizing; h: TSizing }
  fills: TPaint[]
  stroke?: IStroke
  radius: { values: [number, number, number, number]; token?: string }
  effects: TEffect[]
  clip: boolean
  children: TLayerNode[]
}

export interface ITextStyleValues {
  family: string
  weight: number
  sizePx: number
  lineHeightPx: number
  letterSpacingPx: number
  textCase: 'original' | 'upper' | 'lower' | 'title'
  decoration: 'none' | 'underline' | 'strike'
  align: 'left' | 'center' | 'right'
}

export interface ITextNode extends ILayerBase {
  type: 'text'
  text: string
  style: ITextStyleValues
  /** Вариант типографики темы, если стиль узла совпал с ним по всем полям. */
  typography?: string
  color: TColorRef
  autoResize: 'both' | 'height'
  truncate?: boolean
  /** Цвет линии подчёркивания или зачёркивания, если он не совпадает с цветом текста. */
  decorationColor?: TColorRef
  /** Толщина и отступ линии в px, если они заданы явно (`text-decoration-thickness`, `text-underline-offset`). */
  decorationThickness?: number
  decorationOffset?: number
}

export interface ISvgNode extends ILayerBase {
  type: 'svg'
  /** Ключ в `assets.svg`. */
  asset: string
  color?: TColorRef
}

export interface IInstanceNode extends ILayerBase {
  type: 'instance'
  component: string
  variant: Record<string, string>
  overrides: { text: Record<string, string> }
}

export type TLayerNode = IFrameNode | ITextNode | ISvgNode | IInstanceNode

/** Цвета одного режима, как их видит конвертер до слияния режимов. */
export type TRawColor = IRgba

/** Как токен пишут в коде проекта (`theme.palette.primary.main`, `var(--color-primary)`): подсказка в описании и синтаксис кода в Dev Mode; нет - адрес. */
type TTokenCode = string

/** Приоритет токена среди токенов с одинаковыми значениями, по роли краски: меньше - выше, нет - после всех. */
export interface IColorPriority {
  fill?: number
  text?: number
  stroke?: number
}

export interface IColorToken {
  /** Адрес в теме: `palette.primary.main`. */
  id: string
  /** Имя переменной Figma: `primary/main`. */
  name: string
  light: IRgba
  dark: IRgba
  description: string
  code?: TTokenCode
  /** Группа: при равных кандидатах привязка берёт токен той же группы, что у соседа (подпись к фону кнопки). */
  group?: string
  priority?: IColorPriority
  /** Цвет текста: переменная предлагается тексту и фигурам, но не заливке фреймов. */
  text?: boolean
}

export interface INumberToken {
  id: string
  name: string
  value: number
  scope: 'radius' | 'gap'
  description: string
  code?: TTokenCode
  /** Скругление «до круга»: привязывается к углам не меньше половины меньшей стороны бокса. */
  circle?: boolean
}

export interface ITypographyToken {
  id: string
  name: string
  family: string
  weight: number
  sizePx: number
  lineHeight: { unit: 'percent' | 'px'; value: number }
  letterSpacing: { unit: 'percent' | 'px'; value: number }
  textCase: 'original' | 'upper' | 'lower' | 'title'
  code?: TTokenCode
}

export interface IEffectToken {
  id: string
  name: string
  light: TEffect[]
  dark: TEffect[]
  code?: TTokenCode
}

/** Радиальное свечение полотна: центр и радиусы в долях бокса, стопы в долях длины. */
export interface ICanvasGlow {
  cx: number
  cy: number
  rx: number
  ry: number
  stops: { pos: number; color: IRgba }[]
}

/**
 * Роли токенов в оформлении, которое строит сам плагин (подписи, рамки фреймов, полотно папок): id токена
 * темы для каждой роли. Без роли плагин берёт нейтральное значение (Inter, серые).
 */
export interface ITokenRoles {
  /** Цвет полотна папок - фон страницы каталога. */
  canvas?: string
  text?: string
  textSecondary?: string
  textDisabled?: string
  divider?: string
  /** Стили текста: подпись папки, заголовок компонента, подпись истории, описание, мелкие подписи. */
  title?: string
  heading?: string
  subheading?: string
  body?: string
  caption?: string
}

export interface IKitTokens {
  colors: IColorToken[]
  numbers: INumberToken[]
  typography: ITypographyToken[]
  effects: IEffectToken[]
  canvas?: { light: ICanvasGlow[]; dark: ICanvasGlow[] }
  roles?: ITokenRoles
}

export interface IFontSpec {
  family: string
  weights: number[]
}

export interface IComponentAxis {
  name: string
  values: string[]
  /** Описание пропа из docgen истории: плагин подписывает им ось. */
  description?: string
}

/** Значения оси, которые на макете не отличаются от `into` и в набор не вошли (`export/dedupe.mjs`). */
export interface ICollapsedValues {
  axis: string
  values: string[]
  into: string
  description?: string
}

export interface IComponentVariant {
  variant: Record<string, string>
  tree: TLayerNode
  /** Семантические классы корня - сигнатура для поиска экземпляров в других деревьях. */
  signature: string[]
}

export interface IComponentExport {
  id: string
  /** Имя набора в Figma с группой каталога: `Inputs/Button`. */
  name: string
  description: string
  storyUrl: string
  axes: IComponentAxis[]
  textProps: { name: string; path: string }[]
  variants: IComponentVariant[]
  dependsOn: string[]
  /** Склеенные одинаковые на макете значения осей: для подписи набора. */
  collapsed?: ICollapsedValues[]
}

/**
 * Отрисованная история - фрейм на странице: пример компонента, страница Гайдлайна, паттерн, каталог иконок.
 * Компоненты внутри - экземпляры наборов.
 */
export interface IStoryExport {
  /** Идентификатор истории Storybook. */
  id: string
  /** Название истории в каталоге. */
  name: string
  storyUrl: string
  tree: TLayerNode
}

/** Пункт каталога (заголовок Storybook): набор компонента и/или фреймы историй. */
export interface IItemExport {
  /** Заголовок истории в каталоге: `Компоненты MUI/Inputs/Button`. */
  id: string
  /** Последний сегмент заголовка: подпись фрейма пункта. */
  title: string
  description: string
  storyUrl: string
  /** Набор пункта (`IComponentExport.id`). */
  component?: string
  /** Истории пункта фреймами (`IStoryExport.id`) в порядке каталога. */
  stories: string[]
}

/** Раздел страницы - папка каталога (`Inputs`) или пункт без папки: секция на холсте. */
export interface ISectionExport {
  id: string
  title: string
  items: IItemExport[]
}

/** Страница Figma: разделы каталога по конфигурации storyframe. */
export interface IPageExport {
  id: string
  name: string
  sections: ISectionExport[]
}

export interface IKitReport {
  unboundColors: { light: IRgba; dark: IRgba; count: number; where: string[] }[]
  ambiguousColors: { light: IRgba; dark: IRgba; candidates: string[]; chosen: string }[]
  outOfMatrix: string[]
}

export interface IKitBundle {
  schema: number
  kit: { name: string; version: string }
  builtAt: string
  fonts: IFontSpec[]
  tokens: IKitTokens
  assets: { svg: Record<string, string> }
  components: IComponentExport[]
  stories: IStoryExport[]
  pages: IPageExport[]
  /** Раскладка файла из конфигурации storyframe: наибольшая ширина папки на странице. Нет - умолчание плагина. */
  layout?: { maxWidth: number }
  report: IKitReport
}
