/*
 * Merging the light and dark mode trees of one sample into a tree with color references: a pair of values
 * is looked up among the tokens (colorMatch), otherwise it stays as literals. The trees are structurally
 * identical (one DOM); a structure mismatch is a warning, and the light tree is taken.
 */

import type {
  IFrameNode,
  INumberToken,
  IRgba,
  ISvgNode,
  ITextNode,
  TColorRef,
  TEffect,
  TLayerNode,
  TPaint,
} from './capture/types.ts'
import { matchPair, type TPairIndex } from './colorMatch.ts'

export interface IMergeReport {
  unbound: Map<string, { light: IRgba; dark: IRgba; count: number; where: Set<string> }>
  ambiguous: Map<string, { light: IRgba; dark: IRgba; candidates: string[]; chosen: string }>
  mismatches: string[]
}

/** Paint role of a color: the token priority is chosen by it. */
type TColorRole = 'fill' | 'text' | 'stroke'

/** Token group of the surroundings: the children of a primary button prefer `primary.*` tokens. */
interface IMergeScope {
  group: string | undefined
}

/** A color written as literals of both modes; the capture of one mode writes its color into `light`. */
type TLiteralColor = Extract<TColorRef, { light: IRgba }>

type TLinearPaint = Extract<TPaint, { kind: 'linear' }>

export function createMergeReport(): IMergeReport {
  return { unbound: new Map(), ambiguous: new Map(), mismatches: [] }
}

function resolveColor(
  index: TPairIndex,
  report: IMergeReport,
  where: string,
  role: TColorRole,
  lightRef: TColorRef,
  darkRef: TColorRef,
  scope: IMergeScope,
): TColorRef {
  if (!lightRef || !darkRef) return lightRef ?? darkRef
  if ('token' in lightRef) return lightRef
  const light = lightRef.light
  const dark = (darkRef as TLiteralColor).light
  if (lightRef.approx || (darkRef as TLiteralColor).approx) return { light, dark, approx: true }
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
  const entry = report.unbound.get(key) ?? { light, dark, count: 0, where: new Set<string>() }
  entry.count += 1
  if (entry.where.size < 5) entry.where.add(where)
  report.unbound.set(key, entry)
  return { light, dark }
}

function mergePaint(
  index: TPairIndex,
  report: IMergeReport,
  where: string,
  light: TPaint,
  dark: TPaint | undefined,
  scope: IMergeScope,
): TPaint {
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

function mergeEffect(
  index: TPairIndex,
  report: IMergeReport,
  where: string,
  light: TEffect,
  dark: TEffect | undefined,
  scope: IMergeScope,
): TEffect {
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
 * @param index index of palette pairs
 * @param where sample name for the report
 */
export function mergeTrees(
  index: TPairIndex,
  report: IMergeReport,
  where: string,
  light: TLayerNode,
  dark: TLayerNode | null,
  scope: IMergeScope = { group: undefined },
): TLayerNode {
  if (!dark || dark.type !== light.type) {
    if (dark) report.mismatches.push(`${where}: структура тёмного режима отличается на ${light.path || 'корне'}`)
    dark = null
  }
  const at = `${where}${light.path ? ` ${light.path}` : ''}`
  switch (light.type) {
    case 'text':
      return {
        ...light,
        color: resolveColor(
          index,
          report,
          at,
          'text',
          light.color,
          (dark as ITextNode | null)?.color ?? light.color,
          scope,
        ),
        ...(light.decorationColor
          ? {
              decorationColor: resolveColor(
                index,
                report,
                at,
                'text',
                light.decorationColor,
                (dark as ITextNode | null)?.decorationColor ?? light.decorationColor,
                scope,
              ),
            }
          : {}),
      }
    case 'svg':
      return light.color
        ? {
            ...light,
            color: resolveColor(
              index,
              report,
              at,
              'text',
              light.color,
              (dark as ISvgNode | null)?.color ?? light.color,
              scope,
            ),
          }
        : light
    case 'instance':
      return light
    default: {
      // Root fill and stroke set the token group for the children: the label of a primary button takes
      // `primary.contrastText`.
      const fills = light.fills.map((paint, i) =>
        mergePaint(index, report, at, paint, (dark as IFrameNode | null)?.fills?.[i], scope),
      )
      const stroke = light.stroke
        ? {
            ...light.stroke,
            color: resolveColor(
              index,
              report,
              at,
              'stroke',
              light.stroke.color,
              (dark as IFrameNode | null)?.stroke?.color ?? light.stroke.color,
              scope,
            ),
            ...(light.stroke.paint
              ? {
                  paint: mergePaint(
                    index,
                    report,
                    at,
                    light.stroke.paint,
                    (dark as IFrameNode | null)?.stroke?.paint,
                    scope,
                  ) as TLinearPaint,
                }
              : {}),
          }
        : undefined
      const effects = light.effects.map((effect, i) =>
        mergeEffect(index, report, at, effect, (dark as IFrameNode | null)?.effects?.[i], scope),
      )
      const children = light.children.map((child, i) => {
        const darkChild = dark ? ((dark as IFrameNode).children[i] ?? null) : null
        if (dark && !darkChild) report.mismatches.push(`${where}: в тёмном режиме нет слоя ${child.path}`)
        return mergeTrees(index, report, where, child, darkChild, { group: scope.group })
      })
      return { ...light, fills, stroke, effects, children }
    }
  }
}

/**
 * Radii equal to a corner radius token get a reference to it (on all four corners); corners of at least half
 * the shorter side get the circle token, if the theme marked one.
 */
export function bindRadii(tree: TLayerNode, numbers: INumberToken[]): void {
  const radii = numbers.filter((token) => token.scope === 'radius')
  const visit = (node: TLayerNode): void => {
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
