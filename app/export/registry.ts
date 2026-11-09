/*
 * Common rules for the export's component sets: how to reproduce a state of the `State` axis and the shape of a
 * set entry with custom axes. Entries of a specific catalog live in its configuration (`storyframe.config.mjs`,
 * the `components` section).
 */

import type { IStoryframeArgAxis, IStoryframeValuesAxis } from '../config.ts'

export type TAxis = IStoryframeArgAxis | IStoryframeValuesAxis

/**
 * `stateArgs` are the args that show a state without interaction (a field with `focused`): the Storybook docs
 * matrix uses them, since only one cell there can have focus. The export sets the state for real and does not
 * read them.
 */
export type TRegistryEntry = {
  id: string
  name: string
  storyId: string
  storyFile: string
  root: string
  axes: TAxis[]
  states: string[]
  label?: boolean
  fixedArgs?: Record<string, unknown>
  dependsOn?: string[]
  stateArgs?: Record<string, Record<string, unknown>>
}

/** A story's `argTypes` as the export reads them: the list of values and the control type. */
export type TArgTypes = Record<string, { options?: unknown[] | null; control?: unknown }>

/** How a state is reproduced: story args, pseudo-classes of the pseudo-states addon or focus. */
export type TStateRule = { args?: Record<string, unknown>; pseudo?: string[]; focus?: boolean }

/** States of the `State` axis: how to reproduce them, by args, a pseudo-class or focus. */
export const STATES: Record<string, TStateRule> = {
  default: {},
  hover: { pseudo: ['hover'] },
  focus: { focus: true },
  disabled: { args: { disabled: true } },
  error: { args: { error: true } },
}
