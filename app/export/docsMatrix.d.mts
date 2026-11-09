/** Ячейка матрицы: аргументы «Базовой» истории и классы аддона pseudo-states для обёртки. */
export interface IDocsCell {
  key: string
  variant: Record<string, string>
  args: Record<string, unknown>
  pseudo: string[]
}

export interface IDocsMatrix {
  /** Набор, как он называется в выгрузке (`Button`, `MiniDrawerItem`). */
  id: string
  /** История, с которой снимается набор. */
  storyId: string
  axes?: { name: string; values: string[] }[]
  /** Число вариантов. */
  count?: number
  columns?: { key: string; values: [string, string][] }[]
  rows?: { key: string; values: [string, string][]; cells: (IDocsCell | null)[] }[]
  /** Матрицу не построить (у оси нет списка значений в `argTypes`). */
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
