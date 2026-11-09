/*
 * Merging of variants that are indistinguishable in the design. An axis value whose layer tree matches the
 * tree of the default value for all other values does not go into the component set: on the canvas it would
 * be a duplicate (AppBar with `position` fixed and static, Step with `last`, CardActionArea `disabled`). An
 * axis left with a single value leaves the component set entirely. What was merged is in the set's
 * `collapsed`, the Figma plugin writes it into the set's labels.
 */

import type { IBox, ICollapsedValues, IComponentAxis, TLayerNode } from './capture/types.ts'

/** A twin merged into a variant: instances in stories are found by its signature too (`signatures.ts`). */
export interface IVariantAlias {
  signature: string[]
  tree: TLayerNode
}

/** A component set variant during the merging: `stretched` comes from the capture, `aliases` from the merging. */
export interface IDedupeVariant {
  variant: Record<string, string>
  tree: TLayerNode
  signature: string[]
  stretched?: boolean
  aliases?: IVariantAlias[]
}

export interface IDedupeComponent {
  axes: IComponentAxis[]
  variants: IDedupeVariant[]
}

/** Numbers are compared with a 0.1 px step: adjacent captures of the same state differ in the hundredths. */
function rounded(value: unknown): unknown {
  return typeof value === 'number' ? Math.round(value * 10) / 10 : value
}

/**
 * The tree without names, paths and service fields: appearance and geometry are compared. `loose` drops the
 * horizontal geometry (x, width, sizing behavior).
 */
function normalized(node: TLayerNode, loose: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node) as [string, unknown][]) {
    if (key === 'name' || key === 'path' || key === 'classes' || key === 'warnings') continue
    if (key === 'children') out.children = (value as TLayerNode[]).map((child) => normalized(child, loose))
    else if (key === 'box')
      out.box = loose ? { y: rounded((value as IBox).y), h: rounded((value as IBox).h) } : mapNumbers(value)
    else if (key === 'sizing' && loose) continue
    else out[key] = mapNumbers(value)
  }
  return out
}

function mapNumbers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mapNumbers)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      (Object.entries(value) as [string, unknown][]).map(([key, inner]) => [key, mapNumbers(inner)]),
    )
  }
  return rounded(value)
}

/**
 * The trees are identical in the design. Roots of different width (AppBar `position: fixed` as wide as the
 * window, `static` as wide as the container) are compared without horizontal geometry when `loose`: it is the
 * same component in a container of another width, in Figma the width is set by the instance.
 */
export function sameLook(a: TLayerNode, b: TLayerNode, loose = true): boolean {
  if (JSON.stringify(normalized(a, false)) === JSON.stringify(normalized(b, false))) return true
  if (!loose || Math.abs(a.box.w - b.box.w) <= 0.5) return false
  return JSON.stringify(normalized(a, true)) === JSON.stringify(normalized(b, true))
}

function twinOf(
  variants: IDedupeVariant[],
  variant: IDedupeVariant,
  axis: string,
  value: string,
): IDedupeVariant | null {
  return (
    variants.find(
      (other) =>
        other.variant[axis] === value &&
        Object.entries(variant.variant).every(([name, current]) => name === axis || other.variant[name] === current),
    ) ?? null
  )
}

/**
 * Merges the component set's variants that are identical in the design, in place. The merged-away variants
 * stay with the remaining twin in `aliases` (signature and tree): instances in stories are found by them too.
 * @param defaults default value per axis
 */
export function collapseIdentical(
  component: IDedupeComponent,
  defaults: Record<string, string | null>,
): ICollapsedValues[] {
  const collapsed: ICollapsedValues[] = []
  for (const axis of component.axes) {
    const into = defaults[axis.name] ?? axis.values[0]
    if (!axis.values.includes(into)) continue
    const merged: string[] = []
    for (const value of axis.values) {
      if (value === into) continue
      let compared = 0
      let same = true
      for (const variant of component.variants) {
        if (variant.variant[axis.name] !== value) continue
        const twin = twinOf(component.variants, variant, axis.name, into)
        if (!twin) continue
        compared += 1
        // Without horizontal geometry only if the width of both roots was set by the page (`stretched` from the
        // capture): for a Container with `maxWidth` the width is its appearance.
        if (!sameLook(variant.tree, twin.tree, Boolean(variant.stretched && twin.stretched))) {
          same = false
          break
        }
      }
      if (same && compared > 0) merged.push(value)
    }
    if (merged.length === 0) continue
    for (const variant of component.variants) {
      if (!merged.includes(variant.variant[axis.name])) continue
      const twin = twinOf(component.variants, variant, axis.name, into)
      if (!twin) continue
      twin.aliases = [
        ...(twin.aliases ?? []),
        { signature: variant.signature, tree: variant.tree },
        ...(variant.aliases ?? []),
      ]
    }
    component.variants = component.variants.filter((variant) => !merged.includes(variant.variant[axis.name]))
    axis.values = axis.values.filter((value) => !merged.includes(value))
    collapsed.push({
      axis: axis.name,
      values: merged,
      into,
      ...(axis.description ? { description: axis.description } : {}),
    })
  }
  dropSingleAxes(component)
  return collapsed
}

/**
 * Axes with a single value are removed from the component set. Figma needs at least one variant property: if
 * no axis is left, `State` (or the first axis) stays.
 */
export function dropSingleAxes(component: IDedupeComponent): void {
  const single = component.axes.filter((axis) => axis.values.length <= 1)
  if (single.length === 0) return
  const keep =
    single.length === component.axes.length
      ? (component.axes.find((axis) => axis.name === 'State') ?? component.axes[0])
      : null
  const removed = single.filter((axis) => axis !== keep).map((axis) => axis.name)
  component.axes = component.axes.filter((axis) => !removed.includes(axis.name))
  for (const variant of component.variants) for (const name of removed) delete variant.variant[name]
}
