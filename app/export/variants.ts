/*
 * Подписи и сетка вариантов набора - общие для плагина Figma и блока «Варианты» документации Storybook:
 * матрица в файле и на странице компонента читаются одинаково.
 */

/** Подписи значений оси `State`: что за состояние показывает строка или столбец. */
export const STATE_LABELS: Record<string, string> = {
  default: 'обычное состояние',
  hover: 'при наведении',
  focus: 'при фокусе с клавиатуры',
  active: 'при нажатии',
  disabled: 'недоступно',
  error: 'ошибка',
}

/** Подпись значения оси: «Variant=outlined», у состояния - «hover — при наведении». */
export function valueLabel(axis: string, value: string): string {
  if (axis === 'State') return STATE_LABELS[value] ? `${value} — ${STATE_LABELS[value]}` : value
  return `${axis}=${value}`
}

/** Подпись строки или столбца матрицы: значения осей в одну строку («Size=small, Multiline=false»). */
export function axisLabel(values: [string, string][]): string {
  return values.map(([axis, value]) => valueLabel(axis, value)).join(', ')
}

/** Сколько младших осей (размер, состояние) идут в столбцы: две при трёх и более осях, иначе одна. */
export function columnCount(axisCount: number): number {
  return Math.min(axisCount > 2 ? 2 : 1, Math.max(axisCount - 1, 1))
}
