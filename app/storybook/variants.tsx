/*
 * The Variants block of the docs page: the matrix of the component's "Basic" story, all combinations of the
 * axes and the states, the same ones as the set in Figma. The sets, axes and states are chosen by the export
 * rules (`export/docsMatrix.mjs`) and the project configuration, the labels are the same as in the Figma file
 * (`export/variants.ts`). Hover and focus without arguments of their own are shown by the pseudo-states addon
 * with classes on the cell wrapper.
 *
 * A cell is drawn by a story with the `storyframe.cell` parameter: by it the project decorator removes from the
 * cell the padding and background it gives a standalone story.
 */

import { Component, useContext, useEffect, useMemo, type ContextType, type ReactNode } from 'react'
import { DocsContext, Heading, useOf } from '@storybook/addon-docs/blocks'
import { composeStory } from '@storybook/react-vite'
import type { IStoryframeConfig } from '../config.ts'
import { docsMatrices, type IDocsMatrix } from '../export/docsMatrix.ts'
import { axisLabel } from '../export/variants.ts'
import { cellAnnotations } from './cell.ts'

type TDocsContext = ContextType<typeof DocsContext>
type TPreparedStory = ReturnType<TDocsContext['componentStoriesFromCSFFile']>[number]
type TProject = TDocsContext['projectAnnotations']

const NO_CONFIG: IStoryframeConfig = {}

const labelStyle = { fontSize: 12, lineHeight: '16px', opacity: 0.72 } as const

/** A cell where the story crashes does not bring down the docs page. */
class CellBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? <span style={labelStyle}>не отрисовалась</span> : this.props.children
  }
}

type TComposed = ReturnType<typeof composeStory>

/**
 * Cell rendering: a composed story is a function that sets up its own context on every call, so one story per
 * matrix serves all the cells. The call is inside the cell component: the story error is caught by
 * `CellBoundary`, not by the page.
 */
function CellContent({ composed, args }: { composed: TComposed; args: Record<string, unknown> }) {
  return composed(args)
}

function Matrix({
  matrix,
  story,
  meta,
  project,
  titled,
}: {
  matrix: IDocsMatrix
  story: TPreparedStory
  meta: unknown
  project: TProject
  titled: boolean
}) {
  const composed = useMemo(
    () => composeStory(cellAnnotations(story.moduleExport) as never, meta as never, project),
    [story, meta, project],
  )
  if (matrix.error)
    return (
      <p>
        Набор {matrix.id}: матрицу не построить - {matrix.error}
      </p>
    )
  const columns = matrix.columns ?? []
  const rows = matrix.rows ?? []
  const labelled = rows.some((row) => row.values.length > 0)
  return (
    <>
      {titled ? <p style={labelStyle}>Набор {matrix.id}</p> : null}
      {/* `sb-unstyled`: the docs page text styling (Storybook and `preview.tsx`) does not touch the cells. */}
      <div className="sb-unstyled" style={{ overflowX: 'auto', paddingBlock: 8 }}>
        <div
          // A column is no narrower than the natural content width (a field squeezed to the minimum clips its
          // label), the free space is split evenly: stretched components (AppBar) take the cell width.
          style={{
            display: 'grid',
            gridTemplateColumns: `${labelled ? 'max-content ' : ''}repeat(${columns.length}, minmax(max-content, 1fr))`,
            gap: '16px 24px',
            alignItems: 'center',
          }}
        >
          {labelled ? <span /> : null}
          {columns.map((column) => (
            <span key={column.key} style={{ ...labelStyle, textAlign: 'center' }}>
              {axisLabel(column.values)}
            </span>
          ))}
          {rows.map((row) => [
            labelled ? (
              <span key={`${row.key}:label`} style={labelStyle}>
                {axisLabel(row.values)}
              </span>
            ) : null,
            ...row.cells.map((cell, index) =>
              cell ? (
                <div key={cell.key} className={cell.pseudo.join(' ')} title={cell.key}>
                  <CellBoundary>
                    <CellContent composed={composed} args={cell.args} />
                  </CellBoundary>
                </div>
              ) : (
                <span key={`${row.key}:${columns[index]?.key}`} />
              ),
            ),
          ])}
        </div>
      </div>
    </>
  )
}

/**
 * @param config the project's storyframe configuration (`storyframe.config.ts`); without it the sets are found
 *   by the general export rules
 */
export function Variants({ config = NO_CONFIG }: { config?: IStoryframeConfig }) {
  const context = useContext(DocsContext)
  const { csfFile, preparedMeta } = useOf('meta', ['meta'])
  const stories = useMemo(() => context.componentStoriesFromCSFFile(csfFile), [context, csfFile])
  const matrices = useMemo(
    () => docsMatrices(preparedMeta.title, stories, config).filter((matrix) => matrix.error || (matrix.count ?? 0) > 1),
    [preparedMeta.title, stories, config],
  )
  const first = stories.find((story) => story.id === matrices[0]?.storyId)
  // The Storybook context globals are typed as `any`: the mode is read as an unknown value.
  const globals = (first ? context.getStoryContext(first).globals : {}) as Record<string, unknown>
  const mode = typeof globals.mode === 'string' ? globals.mode : ''
  // Composed stories receive the page theme mode: without it the cells would be light in the dark theme.
  const project = useMemo(
    () => ({ ...context.projectAnnotations, initialGlobals: { ...context.projectAnnotations.initialGlobals, mode } }),
    [context, mode],
  )
  // The pseudo-states addon rewrites the `:hover` rules in the page styles on the docs rendered event. MUI
  // inserts the cell styles on their first render (and again on a theme change), after that event.
  useEffect(() => {
    if (matrices.length === 0) return undefined
    const timer = setTimeout(() => context.channel.emit('docsRendered', preparedMeta.id), 0)
    return () => clearTimeout(timer)
  }, [context, matrices.length, mode, preparedMeta.id])

  if (matrices.length === 0) return null
  const meta: unknown = csfFile.moduleExports.default
  return (
    <>
      <Heading>Варианты</Heading>
      <p>
        Все сочетания пропсов «Базовой» истории и состояния - те же варианты, что набор в Figma. Одинаковые на вид
        значения Figma объединяет в один вариант, здесь показаны все.
      </p>
      {matrices.map((matrix) => {
        const story = stories.find((candidate) => candidate.id === matrix.storyId)
        return story ? (
          <Matrix
            key={matrix.id}
            matrix={matrix}
            story={story}
            meta={meta}
            project={project}
            titled={matrices.length > 1}
          />
        ) : null
      })}
    </>
  )
}
