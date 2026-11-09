/*
 * Format of the export for Figma (`kit.json` in the export folder). The types are shared by the DOM-to-layers
 * converter (bundled by esbuild, runs in the catalog page), the export builder and the Figma plugin. The runtime
 * check of the export in the builder is `export/schema.mjs`, which repeats these types.
 */

/**
 * Marker color in SVG markup: `currentColor` (the element's text color) is written as it. The plugin recolors
 * only such fills and strokes into the node color; other SVG colors (multicolor icons, a digit in a circle) stay.
 */
export const SVG_TINT = '#fe01fe'

/** Root pseudo-selector: the story content without wrappers (`capture/index.ts`). */
export const CONTENT_ROOT = '@content'

export const SCHEMA_VERSION = 2

/** Color in Figma units: channels and alpha 0–1. */
export interface IRgba {
  r: number
  g: number
  b: number
  a: number
}

/** Color reference: a palette token (`palette.…` path) or literals for both modes. */
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
      /** Gap between the lines of a wrapping row (`counterAxisSpacing`); without it, `gap`. */
      crossGap?: number
    }

export interface IBox {
  x: number
  y: number
  w: number
  h: number
}

interface ILayerBase {
  /** Node path in the sample tree: child indexes separated by `/`; the plugin matches layers by it on update. */
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
  /** Semantic classes of the element: the builder needs them to find instances; not written to the export. */
  classes?: string[]
}

export interface IStroke {
  color: TColorRef
  weights: [number, number, number, number]
  dash?: number[]
  /** `border-image` gradient: a gradient stroke in Figma; `color` is the fallback color from the middle. */
  paint?: Extract<TPaint, { kind: 'linear' }>
}

export type TSizing = 'hug' | 'fixed' | 'fill'

export interface IFrameNode extends ILayerBase {
  type: 'frame'
  layout: TLayout
  /** How the frame behaves in width and height: hug content, fixed or fill the parent width. */
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
  /** Theme typography variant, if the node style matched it in all fields. */
  typography?: string
  color: TColorRef
  autoResize: 'both' | 'height'
  truncate?: boolean
  /** Color of the underline or strikethrough line, if it differs from the text color. */
  decorationColor?: TColorRef
  /** Line thickness and offset in px, if set explicitly (`text-decoration-thickness`, `text-underline-offset`). */
  decorationThickness?: number
  decorationOffset?: number
}

export interface ISvgNode extends ILayerBase {
  type: 'svg'
  /** Key in `assets.svg`. */
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

/** Colors of a single mode, as the converter sees them before the modes are merged. */
export type TRawColor = IRgba

/**
 * How the token is written in project code (`theme.palette.primary.main`, `var(--color-primary)`): a hint in the
 * description and the code syntax in Dev Mode; without it, the token path.
 */
type TTokenCode = string

/** Token priority among tokens with equal values, per paint role: lower is higher, none means after all others. */
export interface IColorPriority {
  fill?: number
  text?: number
  stroke?: number
}

export interface IColorToken {
  /** Path in the theme: `palette.primary.main`. */
  id: string
  /** Figma variable name: `primary/main`. */
  name: string
  light: IRgba
  dark: IRgba
  description: string
  code?: TTokenCode
  /** Group: among equal candidates, binding picks the token of the neighbour's group (label on a button background). */
  group?: string
  priority?: IColorPriority
  /** Text color: the variable is offered to text and shapes, but not to frame fills. */
  text?: boolean
}

export interface INumberToken {
  id: string
  name: string
  value: number
  scope: 'radius' | 'gap'
  description: string
  code?: TTokenCode
  /** "Full circle" corner radius: bound to corners of at least half the smaller side of the box. */
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

/** Radial canvas glow: center and radii as fractions of the box, stops as fractions of the length. */
export interface ICanvasGlow {
  cx: number
  cy: number
  rx: number
  ry: number
  stops: { pos: number; color: IRgba }[]
}

/**
 * Token roles in the decoration the plugin builds itself (labels, frame borders, folder canvas): the theme token
 * id for each role. Without a role the plugin takes a neutral value (Inter, greys).
 */
export interface ITokenRoles {
  /** Folder canvas color: the catalog page background. */
  canvas?: string
  text?: string
  textSecondary?: string
  textDisabled?: string
  divider?: string
  /** Text styles: folder label, component heading, story label, description, small labels. */
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
  /** Prop description from the story docgen: the plugin labels the axis with it. */
  description?: string
}

/** Axis values indistinguishable from `into` in the design that did not enter the set (`export/dedupe.mjs`). */
export interface ICollapsedValues {
  axis: string
  values: string[]
  into: string
  description?: string
}

export interface IComponentVariant {
  variant: Record<string, string>
  tree: TLayerNode
  /** Semantic classes of the root: the signature for finding instances in other trees. */
  signature: string[]
}

export interface IComponentExport {
  id: string
  /** Set name in Figma with the catalog group: `Inputs/Button`. */
  name: string
  description: string
  storyUrl: string
  axes: IComponentAxis[]
  textProps: { name: string; path: string }[]
  variants: IComponentVariant[]
  dependsOn: string[]
  /** Merged axis values that look the same in the design: for the set label. */
  collapsed?: ICollapsedValues[]
}

/**
 * A rendered story is a frame on the page: a component example, a Guideline page, a pattern, the icon catalog.
 * Components inside are instances of the sets.
 */
export interface IStoryExport {
  /** Storybook story id. */
  id: string
  /** Story name in the catalog. */
  name: string
  storyUrl: string
  tree: TLayerNode
}

/** Catalog item (a Storybook title): the component set and/or story frames. */
export interface IItemExport {
  /** Story title in the catalog: `Компоненты MUI/Inputs/Button`. */
  id: string
  /** Last segment of the title: the item frame label. */
  title: string
  description: string
  storyUrl: string
  /** The item's set (`IComponentExport.id`). */
  component?: string
  /** The item's stories as frames (`IStoryExport.id`) in catalog order. */
  stories: string[]
}

/** Page section: a catalog folder (`Inputs`) or an item without a folder; a section on the canvas. */
export interface ISectionExport {
  id: string
  title: string
  items: IItemExport[]
}

/** Figma page: catalog sections according to the storyframe configuration. */
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
  /**
   * File layout from the storyframe configuration: the largest folder width on a page. Without it, the plugin
   * uses its default.
   */
  layout?: { maxWidth: number }
  report: IKitReport
}
