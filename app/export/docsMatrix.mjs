/*
 * Variant matrices for the Variants block of the Storybook docs: the same component sets, axes and states the
 * export to Figma builds (`plan.mjs` picks the item's set, `discover.mjs` finds the axes, `matrix.mjs` builds
 * the combinations). Without Node modules: the module runs in the browser on the docs page.
 *
 * What the page does not repeat: the merging of visually identical values (the export computes it from the
 * screenshots, here all values are shown) and giving up on a set whose story has no component root by class.
 */

import { normalizeConfig, placeTitle, resolvePages, titleSegments } from './catalog.mjs'
import { pickStory, resolveAutoEntry } from './discover.mjs'
import { buildMatrix } from './matrix.mjs'
import { columnCount } from './variants.ts'

/**
 * `argTypes` of a prepared story in the form the export reads them (`readStoryArgTypes` in `capture.mjs`): the
 * list of values and the control type as a string.
 */
export function normalizeArgTypes(argTypes) {
  return Object.fromEntries(
    Object.entries(argTypes ?? {}).map(([name, argType]) => [
      name,
      { options: argType.options ?? null, control: argType.control?.type ?? argType.control ?? null },
    ]),
  )
}

/** The item's set entries as the export picks them (`planJobs`): the configuration, otherwise the discovered set. */
function entriesOf(title, stories, config) {
  const own = config.components.filter((entry) => stories.some((story) => story.id === entry.storyId))
  if (own.length > 0) return own
  const id = titleSegments(title).at(-1)
  if (id in config.skip || stories.length === 0) return []
  const story = pickStory(stories)
  const argTypes = normalizeArgTypes(story.argTypes)
  return [resolveAutoEntry({ id, storyId: story.id, root: null, axes: [], states: ['default'] }, argTypes)]
}

/** Pseudo-states addon classes for the cell wrapper: `:hover` (and focus without its own args) on descendants. */
function pseudoClasses(state, stateArgs) {
  if (state.pseudo) return state.pseudo.map((pseudo) => `pseudo-${pseudo}-all`)
  if (state.focus && !stateArgs) return ['pseudo-focus-all', 'pseudo-focus-visible-all', 'pseudo-focus-within-all']
  return []
}

/** The matrix grid: columns are the minor axes, rows are the rest; a cell is a sample or `null`. */
function gridOf(axes, samples) {
  const split = axes.length - columnCount(axes.length)
  const rowAxes = axes.slice(0, Math.max(0, split))
  const columnAxes = axes.slice(Math.max(0, split))
  const keyOf = (variant, list) => list.map((axis) => variant[axis.name]).join('|')
  const columns = []
  const rows = []
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
 * @param {string} title the CSF file title
 * @param {{ id: string, argTypes?: Record<string, object> }[]} stories the title's stories in file order
 * @param {object} [rawConfig] contents of `storyframe.config.mjs`
 */
export function docsMatrices(title, stories, rawConfig = {}) {
  const config = normalizeConfig(rawConfig)
  if (!placeTitle(title, resolvePages(config, [title]), config.exclude)) return []
  return entriesOf(title, stories, config).map((entry) => {
    const story = stories.find((candidate) => candidate.id === entry.storyId)
    try {
      const { axes, samples } = buildMatrix(entry, normalizeArgTypes(story?.argTypes))
      const cells = samples.map((sample) => {
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
