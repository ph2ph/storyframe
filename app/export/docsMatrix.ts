/*
 * Variant matrices for the Variants block of the Storybook docs: the same component sets, axes and states the
 * export to Figma builds (`plan.mjs` picks the item's set, `discover.mjs` finds the axes, `matrix.mjs` builds
 * the combinations). Without Node modules: the module runs in the browser on the docs page.
 *
 * What the page does not repeat: the merging of visually identical values (the export computes it from the
 * screenshots, here all values are shown) and giving up on a set whose story has no component root by class.
 */

import type { IStoryframeConfig } from '../config.ts'
import { normalizeConfig, placeTitle, resolvePages, titleSegments, type TConfig } from './catalog.ts'
import { pickStory, resolveAutoEntry } from './discover.ts'
import { buildMatrix, type TMatrixAxis, type TMatrixEntry, type TSample } from './matrix.ts'
import type { TRegistryEntry } from './registry.ts'
import { columnCount } from './variants.ts'

/** A matrix cell: args of the "Basic" story and pseudo-states addon classes for the wrapper. */
export interface IDocsCell {
  key: string
  variant: Record<string, string>
  args: Record<string, unknown>
  pseudo: string[]
}

export interface IDocsMatrix {
  /** The component set as it is named in the export (`Button`, `MiniDrawerItem`). */
  id: string
  /** The story the component set is captured from. */
  storyId: string
  axes?: { name: string; values: string[] }[]
  /** Number of variants. */
  count?: number
  columns?: { key: string; values: [string, string][] }[]
  rows?: { key: string; values: [string, string][]; cells: (IDocsCell | null)[] }[]
  /** The matrix cannot be built (an axis has no list of values in `argTypes`). */
  error?: string
}

/** A story of the title: its id and the `argTypes` of the prepared story. */
type TDocsStory = { id: string; argTypes?: Record<string, unknown> }

/**
 * A Storybook `argType` as far as it is read here: the list of values and the control, an object with a type or
 * the type itself (`control: 'select'`).
 */
type TStoryArgType = { options?: unknown[]; control?: { type?: string } }

/** The item's set entry: from the configuration, or a discovered one without a root. */
type TDocsEntry = TMatrixEntry & Pick<TRegistryEntry, 'id' | 'storyId' | 'stateArgs'>

/** The matrix grid row while it is being filled: cells by column key. */
type TGridRow = { key: string; values: [string, string][]; cells: Map<string, IDocsCell> }

/**
 * `argTypes` of a prepared story in the form the export reads them (`readStoryArgTypes` in `capture.mjs`): the
 * list of values and the control type as a string.
 */
export function normalizeArgTypes(
  argTypes: Record<string, unknown> | undefined,
): Record<string, { options: unknown[] | null; control: string | null }> {
  return Object.fromEntries(
    Object.entries((argTypes ?? {}) as Record<string, TStoryArgType>).map(([name, argType]) => [
      name,
      // A control set by its type alone has no `type` and is taken as is.
      {
        options: argType.options ?? null,
        control: (argType.control?.type ?? argType.control ?? null) as string | null,
      },
    ]),
  )
}

/** The item's set entries as the export picks them (`planJobs`): the configuration, otherwise the discovered set. */
function entriesOf(title: string, stories: TDocsStory[], config: TConfig): TDocsEntry[] {
  const own = config.components.filter((entry) => stories.some((story) => story.id === entry.storyId))
  if (own.length > 0) return own
  // A title always has at least one segment.
  const id = titleSegments(title).at(-1) as string
  if (id in config.skip || stories.length === 0) return []
  const story = pickStory(stories)
  const argTypes = normalizeArgTypes(story.argTypes)
  return [resolveAutoEntry({ id, storyId: story.id, root: null, axes: [], states: ['default'] }, argTypes)]
}

/** Pseudo-states addon classes for the cell wrapper: `:hover` (and focus without its own args) on descendants. */
function pseudoClasses(state: TSample['state'], stateArgs: Record<string, unknown> | undefined): string[] {
  if (state.pseudo) return state.pseudo.map((pseudo) => `pseudo-${pseudo}-all`)
  if (state.focus && !stateArgs) return ['pseudo-focus-all', 'pseudo-focus-visible-all', 'pseudo-focus-within-all']
  return []
}

/** The matrix grid: columns are the minor axes, rows are the rest; a cell is a sample or `null`. */
function gridOf(
  axes: TMatrixAxis[],
  samples: IDocsCell[],
): { columns: NonNullable<IDocsMatrix['columns']>; rows: NonNullable<IDocsMatrix['rows']> } {
  const split = axes.length - columnCount(axes.length)
  const rowAxes = axes.slice(0, Math.max(0, split))
  const columnAxes = axes.slice(Math.max(0, split))
  const keyOf = (variant: Record<string, string>, list: TMatrixAxis[]): string =>
    list.map((axis) => variant[axis.name]).join('|')
  const columns: NonNullable<IDocsMatrix['columns']> = []
  const rows: TGridRow[] = []
  for (const sample of samples) {
    const columnKey = keyOf(sample.variant, columnAxes)
    const rowKey = keyOf(sample.variant, rowAxes)
    if (!columns.some((column) => column.key === columnKey)) {
      columns.push({ key: columnKey, values: columnAxes.map((axis) => [axis.name, sample.variant[axis.name]]) })
    }
    let row = rows.find((candidate) => candidate.key === rowKey)
    if (!row) {
      row = { key: rowKey, values: rowAxes.map((axis) => [axis.name, sample.variant[axis.name]]), cells: new Map() }
      rows.push(row)
    }
    row.cells.set(columnKey, sample)
  }
  return {
    columns,
    rows: rows.map((row) => ({
      key: row.key,
      values: row.values,
      cells: columns.map((column) => row.cells.get(column.key) ?? null),
    })),
  }
}

/**
 * Matrices of the catalog item `title`. A title outside the Figma file (its section is excluded or does not
 * land on any page) and one skipped in the configuration yield no matrices.
 * @param title the CSF file title
 * @param stories the title's stories in file order
 * @param rawConfig contents of `storyframe.config.mjs`
 */
export function docsMatrices(title: string, stories: TDocsStory[], rawConfig: unknown = {}): IDocsMatrix[] {
  const config = normalizeConfig(rawConfig as IStoryframeConfig)
  if (!placeTitle(title, resolvePages(config, [title]), config.exclude)) return []
  return entriesOf(title, stories, config).map((entry) => {
    const story = stories.find((candidate) => candidate.id === entry.storyId)
    try {
      const { axes, samples } = buildMatrix(entry, normalizeArgTypes(story?.argTypes))
      const cells = samples.map((sample): IDocsCell => {
        const stateArgs = entry.stateArgs?.[sample.variant.State]
        return {
          key: sample.key,
          variant: sample.variant,
          args: { ...sample.args, ...stateArgs },
          pseudo: pseudoClasses(sample.state, stateArgs),
        }
      })
      return { id: entry.id, storyId: entry.storyId, axes, count: cells.length, ...gridOf(axes, cells) }
    } catch (error) {
      return { id: entry.id, storyId: entry.storyId, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
