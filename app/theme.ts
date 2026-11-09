/** Theme font: the family and the weights the text styles need. */
export interface IStoryframeFont {
  family: string
  weights: number[]
}

/**
 * How the token is written in project code (`theme.palette.primary.main`, `var(--color-primary)`): a hint in the
 * description and the variable's code syntax in Dev Mode. Without it, the token path.
 */
type TTokenCode = string

/**
 * Color: the mode values in CSS (`#1976d2`, `rgba(0, 0, 0, 0.6)`). Without dark, one value for both modes;
 * `null` means the color is not set in this mode (the variable takes the other mode's value with a note in the
 * description).
 */
export interface IStoryframeColor {
  /** Token path: the export binds layer colors by it (`palette.primary.main`). */
  id: string
  /** Figma variable name; by default the path with `/` instead of dots. */
  name?: string
  light: string | null
  dark?: string | null
  description?: string
  code?: TTokenCode
  /**
   * Token group: if several tokens have the same values, the layer takes the token of the same group as the
   * neighbouring layers (a button label is `primary.contrastText` next to the `primary.main` background).
   */
  group?: string
  /**
   * Priority among tokens with the same values per paint role (fill, text, stroke): lower is higher, no value
   * means after all others. Beyond that the choice goes by the path length.
   */
  priority?: { fill?: number; text?: number; stroke?: number }
  /** Text color: in Figma the variable is offered to text and shapes, but not to frame fills. */
  text?: boolean
}

/** Number: a corner radius or a spacing. */
export interface IStoryframeNumber {
  id: string
  name: string
  value: number
  scope: 'radius' | 'gap'
  description?: string
  code?: TTokenCode
  /** "Full circle" corner radius (pills, avatars): bound to corners of at least half the smaller side of the box. */
  circle?: boolean
}

/** Text style: values as in CSS, the font size in px. */
export interface IStoryframeTypography {
  id: string
  /** Figma style name; by default `Typography/<id>`. */
  name?: string
  fontFamily: string
  fontSize: number
  fontWeight?: number | string
  lineHeight?: number | string
  letterSpacing?: number | string
  textTransform?: string
  code?: TTokenCode
}

/** Shadow: the `box-shadow` of the modes. */
export interface IStoryframeShadow {
  id: string
  /** Effect style name; by default `Shadow/<id>`. */
  name?: string
  light: string
  dark?: string
  code?: TTokenCode
}

/**
 * Plugin decoration roles: the theme token paths the plugin uses to draw the canvas, labels and borders of the
 * documentation. Without a role, the plugin's neutral values.
 */
export interface IStoryframeRoles {
  canvas?: string
  text?: string
  textSecondary?: string
  textDisabled?: string
  divider?: string
  title?: string
  heading?: string
  subheading?: string
  body?: string
  caption?: string
}

/** Project theme in the storyframe format. */
export interface IStoryframeTheme {
  fonts: IStoryframeFont[]
  colors: IStoryframeColor[]
  numbers: IStoryframeNumber[]
  typography: IStoryframeTypography[]
  shadows: IStoryframeShadow[]
  /** Canvas glow: the CSS `radial-gradient(...)` of the modes over the color of the `canvas` role. */
  canvas?: { light?: string; dark?: string }
  roles?: IStoryframeRoles
}
