/*
 * Склейка вариантов, которые на макете не отличаются. Значение оси, у которого при всех прочих значениях дерево
 * слоёв совпадает с деревом значения по умолчанию, в набор не идёт: на холсте это был бы дубль (AppBar с
 * `position` fixed и static, Step с `last`, CardActionArea `disabled`). Ось, у которой осталось одно значение,
 * уходит из набора целиком. Что склеено - в `collapsed` набора, плагин пишет это в подписях набора.
 */

/** Числа сравниваются с шагом 0,1 px: соседние съёмки одного состояния расходятся в сотых. */
function rounded(value) {
  return typeof value === 'number' ? Math.round(value * 10) / 10 : value
}

/**
 * Дерево без имён, путей и служебных полей: сравниваются облик и геометрия. `loose` - без горизонтальной
 * геометрии (x, ширина, поведение размера).
 */
function normalized(node, loose) {
  const out = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === 'name' || key === 'path' || key === 'classes' || key === 'warnings') continue
    if (key === 'children') out.children = value.map((child) => normalized(child, loose))
    else if (key === 'box') out.box = loose ? { y: rounded(value.y), h: rounded(value.h) } : mapNumbers(value)
    else if (key === 'sizing' && loose) continue
    else out[key] = mapNumbers(value)
  }
  return out
}

function mapNumbers(value) {
  if (Array.isArray(value)) return value.map(mapNumbers)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, mapNumbers(inner)]))
  }
  return rounded(value)
}

/**
 * Деревья одинаковы на макете. Корни разной ширины (AppBar `position: fixed` шириной в окно, `static` - в
 * контейнер) при `loose` сравниваются без горизонтальной геометрии: это тот же компонент в другом по ширине
 * контейнере, в Figma ширину задаёт экземпляр.
 */
export function sameLook(a, b, loose = true) {
  if (JSON.stringify(normalized(a, false)) === JSON.stringify(normalized(b, false))) return true
  if (!loose || Math.abs(a.box.w - b.box.w) <= 0.5) return false
  return JSON.stringify(normalized(a, true)) === JSON.stringify(normalized(b, true))
}

function twinOf(variants, variant, axis, value) {
  return (
    variants.find(
      (other) =>
        other.variant[axis] === value &&
        Object.entries(variant.variant).every(([name, current]) => name === axis || other.variant[name] === current),
    ) ?? null
  )
}

/**
 * Склеивает одинаковые на макете варианты набора на месте. Варианты, ушедшие в склейку, остаются у оставшегося
 * двойника в `aliases` (сигнатура и дерево): экземпляры в историях находятся и по ним.
 * @param {{ axes: { name: string, values: string[], description?: string }[], variants: { variant: Record<string, string>, tree: object, signature: string[], aliases?: object[] }[] }} component
 * @param {Record<string, string | null>} defaults значение по умолчанию на ось
 * @returns {{ axis: string, values: string[], into: string, description?: string }[]}
 */
export function collapseIdentical(component, defaults) {
  const collapsed = []
  for (const axis of component.axes) {
    const into = defaults[axis.name] ?? axis.values[0]
    if (!axis.values.includes(into)) continue
    const merged = []
    for (const value of axis.values) {
      if (value === into) continue
      let compared = 0
      let same = true
      for (const variant of component.variants) {
        if (variant.variant[axis.name] !== value) continue
        const twin = twinOf(component.variants, variant, axis.name, into)
        if (!twin) continue
        compared += 1
        // Без горизонтальной геометрии - только если ширину обоих корней задала страница (`stretched` съёмки):
        // у Container с `maxWidth` ширина и есть его облик.
        if (!sameLook(variant.tree, twin.tree, Boolean(variant.stretched && twin.stretched))) {
          same = false
          break
        }
      }
      if (same && compared > 0) merged.push(value)
    }
    if (merged.length === 0) continue
    for (const variant of component.variants) {
      if (!merged.includes(variant.variant[axis.name])) continue
      const twin = twinOf(component.variants, variant, axis.name, into)
      if (!twin) continue
      twin.aliases = [
        ...(twin.aliases ?? []),
        { signature: variant.signature, tree: variant.tree },
        ...(variant.aliases ?? []),
      ]
    }
    component.variants = component.variants.filter((variant) => !merged.includes(variant.variant[axis.name]))
    axis.values = axis.values.filter((value) => !merged.includes(value))
    collapsed.push({
      axis: axis.name,
      values: merged,
      into,
      ...(axis.description ? { description: axis.description } : {}),
    })
  }
  dropSingleAxes(component)
  return collapsed
}

/**
 * Оси с одним значением из набора убираются. Figma нужно хотя бы одно свойство варианта: если не осталось ни
 * одной оси, остаётся `State` (или первая ось).
 */
export function dropSingleAxes(component) {
  const single = component.axes.filter((axis) => axis.values.length <= 1)
  if (single.length === 0) return
  const keep =
    single.length === component.axes.length
      ? (component.axes.find((axis) => axis.name === 'State') ?? component.axes[0])
      : null
  const removed = single.filter((axis) => axis !== keep).map((axis) => axis.name)
  component.axes = component.axes.filter((axis) => !removed.includes(axis.name))
  for (const variant of component.variants) for (const name of removed) delete variant.variant[name]
}
