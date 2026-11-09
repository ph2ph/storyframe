/*
 * Блок «Варианты» страницы документации: матрица «Базовой» истории компонента - все сочетания осей и
 * состояния, те же, что набор в Figma. Наборы, оси и состояния выбираются по правилам выгрузки
 * (`export/docsMatrix.mjs`) и конфигурации проекта, подписи - те же, что в файле Figma (`export/variants.ts`).
 * Наведение и фокус без своих аргументов показывает аддон pseudo-states классами на обёртке ячейки.
 *
 * Ячейка рисуется историей с параметром `storyframe.cell`: декоратор проекта по нему снимает у неё поля и
 * фон, которые он даёт отдельной истории.
 */

import { Component, useContext, useEffect, useMemo, type ContextType, type ReactNode } from 'react'
import { DocsContext, Heading, useOf } from '@storybook/addon-docs/blocks'
import { composeStory } from '@storybook/react-vite'
import type { IStoryframeConfig } from '../config.d.mts'
import { docsMatrices, type IDocsMatrix } from '../export/docsMatrix.mjs'
import { axisLabel } from '../export/variants'
import { cellAnnotations } from './cell'

type TDocsContext = ContextType<typeof DocsContext>
type TPreparedStory = ReturnType<TDocsContext['componentStoriesFromCSFFile']>[number]
type TProject = TDocsContext['projectAnnotations']

const NO_CONFIG: IStoryframeConfig = {}

const labelStyle = { fontSize: 12, lineHeight: '16px', opacity: 0.72 } as const

/** Ячейка, на которой история падает, не роняет страницу документации. */
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
 * Отрисовка ячейки: составная история - функция, которая на каждый вызов заводит свой контекст, поэтому
 * одна история на матрицу обслуживает все ячейки. Вызов внутри компонента ячейки: ошибку истории ловит
 * `CellBoundary`, а не страница.
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
      {/* `sb-unstyled`: оформление текста страницы документации (Storybook и `preview.tsx`) не трогает ячейки. */}
      <div className="sb-unstyled" style={{ overflowX: 'auto', paddingBlock: 8 }}>
        <div
          // Столбец не уже естественной ширины содержимого (поле, сжатое до минимума, обрезает подпись),
          // свободное место делится поровну: растянутые компоненты (AppBar) занимают ширину ячейки.
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
 * @param config конфигурация storyframe проекта (`storyframe.config.ts`); без неё наборы ищутся по общим
 *   правилам выгрузки
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
  // Глобалы контекста Storybook типизированы как `any`: режим читается как неизвестное значение.
  const globals = (first ? context.getStoryContext(first).globals : {}) as Record<string, unknown>
  const mode = typeof globals.mode === 'string' ? globals.mode : ''
  // Составные истории получают режим темы страницы: без него ячейки были бы светлыми в тёмной теме.
  const project = useMemo(
    () => ({ ...context.projectAnnotations, initialGlobals: { ...context.projectAnnotations.initialGlobals, mode } }),
    [context, mode],
  )
  // Аддон pseudo-states переписывает правила `:hover` в стилях страницы по событию отрисовки документации.
  // Стили ячеек MUI вставляет при их первом рендере (и заново при смене темы) - после этого события.
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
