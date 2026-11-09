/*
 * Labels and grid of a component set's variants, shared by the Figma plugin and the "Variants" block of the
 * Storybook docs: the matrix in the file and on the component page read the same way.
 */

/** Labels of the `State` axis values: which state the row or column shows. */
export const STATE_LABELS: Record<string, string> = {
  default: 'обычное состояние',
  hover: 'при наведении',
  focus: 'при фокусе с клавиатуры',
  active: 'при нажатии',
  disabled: 'недоступно',
  error: 'ошибка',
}

/** Label of an axis value: "Variant=outlined", for a state "hover — при наведении". */
export function valueLabel(axis: string, value: string): string {
  if (axis === 'State') return STATE_LABELS[value] ? `${value} — ${STATE_LABELS[value]}` : value
  return `${axis}=${value}`
}

/** Label of a matrix row or column: the axis values on one line ("Size=small, Multiline=false"). */
export function axisLabel(values: [string, string][]): string {
  return values.map(([axis, value]) => valueLabel(axis, value)).join(', ')
}

/** How many minor axes (size, state) go into columns: two with three or more axes, otherwise one. */
export function columnCount(axisCount: number): number {
  return Math.min(axisCount > 2 ? 2 : 1, Math.max(axisCount - 1, 1))
}
