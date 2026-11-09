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

export function normalizeArgTypes(
  argTypes: Record<string, unknown> | undefined,
): Record<string, { options: unknown[] | null; control: string | null }>

export function docsMatrices(
  title: string,
  stories: { id: string; argTypes?: Record<string, unknown> }[],
  rawConfig?: unknown,
): IDocsMatrix[]
