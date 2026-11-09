/*
 * Сведение деревьев светлого и тёмного режимов одного образца в дерево с ссылками на цвета: пара значений
 * ищется среди токенов (colorMatch), иначе остаётся литералами. Деревья структурно одинаковы (один DOM);
 * расхождение структуры - предупреждение, берётся светлое дерево.
 */

import { matchPair } from './colorMatch.mjs'

/** @typedef {{ unbound: Map<string, { light: object, dark: object, count: number, where: Set<string> }>, ambiguous: Map<string, object>, mismatches: string[] }} IMergeReport */

export function createMergeReport() {
  return { unbound: new Map(), ambiguous: new Map(), mismatches: [] }
}

function resolveColor(index, report, where, role, lightRef, darkRef, scope) {
  if (!lightRef || !darkRef) return lightRef ?? darkRef
  if ('token' in lightRef) return lightRef
  const light = lightRef.light
  const dark = darkRef.light
  if (lightRef.approx || darkRef.approx) return { light, dark, approx: true }
  const match = matchPair(index, light, dark, role, scope.group)
  if (match) {
    if (match.candidates.length > 1) {
      const key = `${match.token}|${match.candidates.join(',')}`
      if (!report.ambiguous.has(key))
        report.ambiguous.set(key, { light, dark, candidates: match.candidates, chosen: match.token })
    }
    scope.group ??= match.group
    return match.opacity === undefined ? { token: match.token } : { token: match.token, opacity: match.opacity }
  }
  const key = `${JSON.stringify(light)}|${JSON.stringify(dark)}`
  const entry = report.unbound.get(key) ?? { light, dark, count: 0, where: new Set() }
  entry.count += 1
  if (entry.where.size < 5) entry.where.add(where)
  report.unbound.set(key, entry)
  return { light, dark }
}

function mergePaint(index, report, where, light, dark, scope) {
  if (light.kind === 'solid') {
    return {
      kind: 'solid',
      color: resolveColor(
        index,
        report,
        where,
        'fill',
        light.color,
        dark?.kind === 'solid' ? dark.color : light.color,
        scope,
      ),
    }
  }
  return {
    kind: 'linear',
    angle: light.angle,
    stops: light.stops.map((stop, i) => ({
      pos: stop.pos,
      color: resolveColor(
        index,
        report,
        where,
        'fill',
        stop.color,
        dark?.kind === 'linear' ? (dark.stops[i]?.color ?? stop.color) : stop.color,
        scope,
      ),
    })),
  }
}

function mergeEffect(index, report, where, light, dark, scope) {
  if (light.type === 'backgroundBlur') return light
  return {
    ...light,
    color: resolveColor(
      index,
      report,
      where,
      'fill',
      light.color,
      dark?.type === light.type ? dark.color : light.color,
      scope,
    ),
  }
}

/**
 * @param {Map} index индекс пар палитры
 * @param {IMergeReport} report
 * @param {string} where имя образца для отчёта
 */
export function mergeTrees(index, report, where, light, dark, scope = { group: undefined }) {
  if (!dark || dark.type !== light.type) {
    if (dark) report.mismatches.push(`${where}: структура тёмного режима отличается на ${light.path || 'корне'}`)
    dark = null
  }
  const at = `${where}${light.path ? ` ${light.path}` : ''}`
  switch (light.type) {
    case 'text':
      return {
        ...light,
        color: resolveColor(index, report, at, 'text', light.color, dark?.color ?? light.color, scope),
        ...(light.decorationColor
          ? {
              decorationColor: resolveColor(
                index,
                report,
                at,
                'text',
                light.decorationColor,
                dark?.decorationColor ?? light.decorationColor,
                scope,
              ),
            }
          : {}),
      }
    case 'svg':
      return light.color
        ? { ...light, color: resolveColor(index, report, at, 'text', light.color, dark?.color ?? light.color, scope) }
        : light
    case 'instance':
      return light
    default: {
      // Заливка и обводка корня задают группу токенов детям: подпись primary-кнопки берёт `primary.contrastText`.
      const fills = light.fills.map((paint, i) => mergePaint(index, report, at, paint, dark?.fills?.[i], scope))
      const stroke = light.stroke
        ? {
            ...light.stroke,
            color: resolveColor(
              index,
              report,
              at,
              'stroke',
              light.stroke.color,
              dark?.stroke?.color ?? light.stroke.color,
              scope,
            ),
            ...(light.stroke.paint
              ? { paint: mergePaint(index, report, at, light.stroke.paint, dark?.stroke?.paint, scope) }
              : {}),
          }
        : undefined
      const effects = light.effects.map((effect, i) =>
        mergeEffect(index, report, at, effect, dark?.effects?.[i], scope),
      )
      const children = light.children.map((child, i) => {
        const darkChild = dark ? (dark.children[i] ?? null) : null
        if (dark && !darkChild) report.mismatches.push(`${where}: в тёмном режиме нет слоя ${child.path}`)
        return mergeTrees(index, report, where, child, darkChild, { group: scope.group })
      })
      return { ...light, fills, stroke, effects, children }
    }
  }
}

/**
 * Радиусы, равные токену скругления, получают ссылку на него (по всем четырём углам); углы не меньше половины
 * меньшей стороны - на токен «до круга», если тема его отметила.
 */
export function bindRadii(tree, numbers) {
  const radii = numbers.filter((token) => token.scope === 'radius')
  const visit = (node) => {
    if (node.type !== 'frame') return
    const [a, b, c, d] = node.radius.values
    if (a === b && b === c && c === d && a > 0) {
      const circle = radii.find((token) => token.circle)
      const exact = radii.find((token) => token.value === a)
      if (circle && a >= Math.min(node.box.w, node.box.h) / 2 - 0.01) node.radius.token = circle.id
      else if (exact) node.radius.token = exact.id
    }
    for (const child of node.children) visit(child)
  }
  visit(tree)
}
