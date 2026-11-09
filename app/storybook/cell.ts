/*
 * The `storyframe.cell` parameter: the story is rendered as a cell of the Variants block. By it the project
 * decorator removes from the cell the padding and background it gives a standalone story.
 */

/** Story annotations with the cell parameter. */
export function cellAnnotations(source: unknown): Record<string, unknown> {
  const annotations = (typeof source === 'function' ? { render: source } : (source ?? {})) as Record<string, unknown>
  const parameters = (annotations.parameters ?? {}) as Record<string, unknown>
  const own = (parameters.storyframe ?? {}) as Record<string, unknown>
  return { ...annotations, parameters: { ...parameters, storyframe: { ...own, cell: true } } }
}

/** The story is rendered as a cell of the Variants block: for the project decorator (`context.parameters`). */
export function isVariantsCell(parameters: Record<string, unknown> | undefined): boolean {
  const own = parameters?.storyframe as { cell?: unknown } | undefined
  return own?.cell === true
}
