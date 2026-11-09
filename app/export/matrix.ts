/*
 * Variant matrix of a component: the Cartesian product of the registry axes over values from the story's
 * `argTypes` plus the `State` axis. Each combination is a sample for capture with story args and a way to
 * reproduce the state.
 */

import type { IComponentAxis } from './capture/types.ts'
import { STATES, type TArgTypes, type TAxis, type TRegistryEntry } from './registry.ts'

/** The part of a set entry the matrix is built from; a discovered set has no root until it is found in the story. */
export type TMatrixEntry = Pick<TRegistryEntry, 'axes' | 'states' | 'fixedArgs'> & { root: string | null }
/** A matrix axis in the export format: the builder adds the prop description to it. */
export type TMatrixAxis = IComponentAxis
export type TVariant = Record<string, string>
export type TSample = {
  key: string
  variant: TVariant
  args: Record<string, unknown>
  root: string | null
  state: { pseudo?: string[]; focus?: boolean }
}

export const MAX_VARIANTS = 250

export function axisValues(axis: TAxis, argTypes: TArgTypes): string[] {
  if ('values' in axis) return Object.keys(axis.values)
  const options = argTypes[axis.arg]?.options
  if (!options) throw new Error(`в argTypes истории нет списка значений для ${axis.arg}`)
  return options.map(String).filter((value) => !(axis.exclude ?? []).includes(value))
}

function axisArgs(axis: TAxis, value: string): Record<string, unknown> {
  if (!('values' in axis)) return { [axis.arg]: value }
  const args = { ...axis.values[value] }
  delete args.root
  return args
}

/** Sample root for an axis value when the axis overrides it (a tab: the selected one or its neighbor). */
function axisRoot(axis: TAxis, value: string): string | null {
  return 'values' in axis ? ((axis.values[value].root as string | undefined) ?? null) : null
}

export function buildMatrix(entry: TMatrixEntry, argTypes: TArgTypes): { axes: TMatrixAxis[]; samples: TSample[] } {
  const axes: TMatrixAxis[] = entry.axes.map((axis) => ({ name: axis.name, values: axisValues(axis, argTypes) }))
  // A Figma component set needs at least one property: a component without axes gets State even with a single
  // state, otherwise its variant is named with an empty string and the set is considered broken.
  const withState = entry.states.length > 1 || axes.length === 0
  if (withState) axes.push({ name: 'State', values: entry.states })
  let combos: TVariant[] = [{}]
  for (const [index, axis] of entry.axes.entries()) {
    combos = combos.flatMap((combo) => axes[index].values.map((value) => ({ ...combo, [axis.name]: value })))
  }
  if (withState) {
    combos = combos.flatMap((combo) => entry.states.map((state) => ({ ...combo, State: state })))
  }
  const samples = combos.map((variant): TSample => {
    const args: Record<string, unknown> = { ...(entry.fixedArgs ?? {}) }
    let root = entry.root
    for (const axis of entry.axes) {
      Object.assign(args, axisArgs(axis, variant[axis.name]))
      root = axisRoot(axis, variant[axis.name]) ?? root
    }
    const state = STATES[variant.State ?? entry.states[0] ?? 'default'] ?? {}
    Object.assign(args, state.args ?? {})
    return { key: variantKey(variant, axes), variant, args, root, state: { pseudo: state.pseudo, focus: state.focus } }
  })
  return { axes, samples }
}

export function variantKey(variant: TVariant, axes: { name: string }[]): string {
  return axes.map((axis) => `${axis.name}=${variant[axis.name]}`).join(', ')
}

/** Matrix checks: size and duplicates. Returns the list of violations. */
export function checkMatrix(entry: { id: string }, samples: { key: string }[]): string[] {
  const problems: string[] = []
  if (samples.length > MAX_VARIANTS)
    problems.push(`${entry.id}: матрица из ${samples.length} вариантов больше ${MAX_VARIANTS}`)
  const keys = new Set<string>()
  for (const sample of samples) {
    if (keys.has(sample.key)) problems.push(`${entry.id}: дубль варианта ${sample.key}`)
    keys.add(sample.key)
  }
  return problems
}
