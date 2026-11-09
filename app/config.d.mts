/** Set axis by a story argument: the values come from `argTypes`, minus the excluded ones. */
export interface IStoryframeArgAxis {
  name: string
  arg: string
  exclude?: string[]
}

/** Set axis with explicit values: story arguments or the root (`{ root: selector }`) for each value. */
export interface IStoryframeValuesAxis {
  name: string
  values: Record<string, Record<string, unknown>>
}

export type TStoryframeState = 'default' | 'hover' | 'focus' | 'disabled' | 'error'

/** A set with axes that the export cannot derive from `argTypes` on its own. */
export interface IStoryframeComponent {
  /** Set name in the Figma file and the key for skips and exceptions. */
  id: string
  /** Group and name of the set (`Inputs/Button`). */
  name: string
  storyId: string
  storyFile: string
  /** Selector of the component root in the story. */
  root: string
  axes: (IStoryframeArgAxis | IStoryframeValuesAxis)[]
  states: TStoryframeState[]
  /** The first text layer is the set's `Label` property. */
  label?: boolean
  fixedArgs?: Record<string, unknown>
  dependsOn?: string[]
  /** Arguments that show the state without interaction (a field with `focused`): for the Variants block. */
  stateArgs?: Partial<Record<TStoryframeState, Record<string, unknown>>>
}

/** Figma page: catalog sections by story title prefixes. */
export interface IStoryframePage {
  /** Page id in the file: the plugin finds the page by it on the next run. Defaults to `name`. */
  id?: string
  name: string
  include: string[]
}

export interface IStoryframeConfig {
  /** Storybook static build relative to the project root. Defaults to `storybook-static`. */
  storybook?: string
  /** Export folder. Defaults to `<storybook>/figma-data`. */
  out?: string
  /** Working folder: plugin builds, comparison screenshots. Defaults to `.storyframe`. */
  workDir?: string
  /** Project theme module: its default export is a storyframe-format theme (the `@ph2ph/storyframe/mui` adapter). */
  theme?: string
  /** URL of the published Storybook for the "Story" links. */
  storyUrl?: string
  /** Figma pages. By default, a page for each top-level section of the catalog. */
  pages?: IStoryframePage[]
  /** Title prefixes left out of the file. */
  exclude?: string[]
  /** Components that do not become sets: name → reason. */
  skip?: Record<string, string>
  components?: IStoryframeComponent[]
  /** Sets allowed to have colors not bound to tokens: id → reason. */
  unboundExceptions?: Record<string, string>
  /** File layout: the largest folder width on a page (by default the plugin takes 1980). */
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
