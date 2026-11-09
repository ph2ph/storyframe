/*
 * Матрицы вариантов для блока «Варианты» документации Storybook: те же наборы, оси и состояния, что строит
 * выгрузка в Figma (`plan.mjs` выбирает набор пункта, `discover.mjs` находит оси, `matrix.mjs` строит
 * сочетания). Без модулей Node: модуль работает в браузере на странице документации.
 *
 * Чего страница не повторяет: склейку одинаковых на вид значений (её считает выгрузка по снимкам - здесь
 * показаны все значения) и отказ от набора, у истории которого нет корня компонента по классу.
 */

import { normalizeConfig, placeTitle, resolvePages, titleSegments } from './catalog.mjs'
import { pickStory, resolveAutoEntry } from './discover.mjs'
import { buildMatrix } from './matrix.mjs'
import { columnCount } from './variants.ts'

/**
 * `argTypes` подготовленной истории в виде, в каком их читает выгрузка (`readStoryArgTypes` в `capture.mjs`):
 * список значений и тип контрола строкой.
 */
export function normalizeArgTypes(argTypes) {
  return Object.fromEntries(
    Object.entries(argTypes ?? {}).map(([name, argType]) => [
      name,
      { options: argType.options ?? null, control: argType.control?.type ?? argType.control ?? null },
    ]),
  )
}

/** Записи наборов пункта так, как их выбирает выгрузка (`planJobs`): конфигурация, иначе найденный набор. */
function entriesOf(title, stories, config) {
  const own = config.components.filter((entry) => stories.some((story) => story.id === entry.storyId))
  if (own.length > 0) return own
  const id = titleSegments(title).at(-1)
  if (id in config.skip || stories.length === 0) return []
  const story = pickStory(stories)
  const argTypes = normalizeArgTypes(story.argTypes)
  return [resolveAutoEntry({ id, storyId: story.id, root: null, axes: [], states: ['default'] }, argTypes)]
}

/** Классы аддона pseudo-states для обёртки ячейки: `:hover` (и фокус без своих аргументов) у потомков. */
function pseudoClasses(state, stateArgs) {
  if (state.pseudo) return state.pseudo.map((pseudo) => `pseudo-${pseudo}-all`)
  if (state.focus && !stateArgs) return ['pseudo-focus-all', 'pseudo-focus-visible-all', 'pseudo-focus-within-all']
  return []
}

/** Сетка матрицы: столбцы - младшие оси, строки - остальные; ячейка - образец или `null`. */
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
 * Матрицы пункта каталога `title`. Заголовок вне файла Figma (раздел исключён или не попадает ни на одну
 * страницу) и пропущенный в конфигурации матриц не дают.
 * @param {string} title заголовок CSF-файла
 * @param {{ id: string, argTypes?: Record<string, object> }[]} stories истории заголовка в порядке файла
 * @param {object} [rawConfig] содержимое `storyframe.config.mjs`
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
