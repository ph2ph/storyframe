import type { IStoryframeTheme } from '../theme.d.mts'

/**
 * MUI theme to the extent the adapter reads it: the result of `createTheme` fits as is. The type is open so
 * that storyframe does not depend on the `@mui/material` version.
 */
export interface IMuiThemeLike {
  palette?: object
  shape?: object
  spacing: (step: number) => string | number
  typography?: object
  shadows?: readonly string[]
}

export interface IMuiThemeOptions {
  light: IMuiThemeLike
  /** Dark theme; without it both modes take the light one. */
  dark?: IMuiThemeLike
  /** Theme fonts and their weights. By default, the families and weights of the text styles. */
  fonts?: { family: string; weights: number[] }[]
  /** Corner radii: `theme.shape` key → variable name (`borderRadius` → `md`). By default, all numbers of `shape`. */
  radii?: Record<string, string>
  /** `theme.spacing(n)` steps that become spacing variables. Defaults to 0.5, 1, 1.5, 2, 3, 4, 6, 8. */
  spacing?: number[]
  /** Shadow names by `theme.shadows` index (`{ 1: 'xs' }`). By default, the index. */
  shadowNames?: Record<number, string>
  /** Extra text styles: variants with a different family (`Typography/mono/body1`). */
  extraTypography?: { prefix: string; fontFamily: string; variants: string[] }[]
  /** Canvas glow: the value path in the theme (`palette.background.gradient`) or a function of the mode's theme. */
  canvas?: string | ((theme: IMuiThemeLike) => string | undefined)
  /** Token description by path (`palette.primary.main`, `shape.borderRadius`). */
  describe?: (address: string) => string | undefined
  /** Plugin decoration roles on top of the default MUI roles. */
  roles?: Partial<Record<keyof typeof MUI_ROLES, string>>
  /**
   * Priorities of colors with the same values per paint role instead of `MUI_COLOR_PRIORITY` (role lists are
   * replaced as a whole): the first matching path pattern wins. For a palette with extensions.
   */
  colorPriority?: Partial<Record<'fill' | 'text' | 'stroke', RegExp[]>>
  /** Which palette paths are text colors, instead of `MUI_TEXT_COLOR`. */
  textColor?: RegExp
  /** The `theme.shape` key with the "full circle" corner radius (pills, avatars). */
  circleRadius?: string
}

export const MUI_ROLES: {
  canvas: string
  text: string
  textSecondary: string
  textDisabled: string
  divider: string
  title: string
  heading: string
  subheading: string
  body: string
  caption: string
}

export const MUI_COLOR_PRIORITY: Record<'fill' | 'text' | 'stroke', RegExp[]>

export const MUI_TEXT_COLOR: RegExp

export function muiTheme(options: IMuiThemeOptions): IStoryframeTheme
