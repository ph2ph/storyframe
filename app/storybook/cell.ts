/*
 * Параметр `storyframe.cell`: история отрисована ячейкой блока «Варианты». Декоратор проекта по нему снимает
 * у ячейки поля и фон, которые он даёт отдельной истории.
 */

/** Аннотации истории с параметром ячейки. */
export function cellAnnotations(source: unknown): Record<string, unknown> {
  const annotations = (typeof source === 'function' ? { render: source } : (source ?? {})) as Record<string, unknown>
  const parameters = (annotations.parameters ?? {}) as Record<string, unknown>
  const own = (parameters.storyframe ?? {}) as Record<string, unknown>
  return { ...annotations, parameters: { ...parameters, storyframe: { ...own, cell: true } } }
}

/** История отрисована ячейкой блока «Варианты»: для декоратора проекта (`context.parameters`). */
export function isVariantsCell(parameters: Record<string, unknown> | undefined): boolean {
  const own = parameters?.storyframe as { cell?: unknown } | undefined
  return own?.cell === true
}
