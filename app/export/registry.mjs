/*
 * Common rules for the export's component sets: how to reproduce a state of the `State` axis and the shape of a
 * set entry with custom axes. Entries of a specific catalog live in its configuration (`storyframe.config.mjs`,
 * the `components` section).
 */

/**
 * @typedef {{ name: string, arg: string, exclude?: string[] } | { name: string, values: Record<string, object> }} TAxis
 * @typedef {{ id: string, name: string, storyId: string, storyFile: string, root: string, axes: TAxis[], states: string[], label?: boolean, fixedArgs?: object, dependsOn?: string[], stateArgs?: Record<string, object> }} TRegistryEntry
 *
 * `stateArgs` are the args that show a state without interaction (a field with `focused`): the Storybook docs
 * matrix uses them, since only one cell there can have focus. The export sets the state for real and does not
 * read them.
 */

/** States of the `State` axis: how to reproduce them, by args, a pseudo-class or focus. */
export const STATES = {
  default: {},
  hover: { pseudo: ['hover'] },
  focus: { focus: true },
  disabled: { args: { disabled: true } },
  error: { args: { error: true } },
}
