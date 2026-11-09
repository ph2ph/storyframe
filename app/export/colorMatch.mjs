/*
 * Binding of layer colors to palette tokens by the pair of values of both modes (design, decision 3): a match
 * in only one mode is misleading, while the pair is unambiguous. Several tokens with the same pair: the choice
 * goes by token priority for the paint role and then by token path length, the order is deterministic.
 * Priorities and groups are set by the theme (the adapter): the core does not know how the project's token
 * paths are structured.
 */

import { colorKey } from './capture/css.ts'

export function pairKey(light, dark) {
  return `${colorKey(light)}|${colorKey(dark)}`
}

/** Index of palette pairs: pair key → tokens in export order. */
export function buildPairIndex(colors) {
  const index = new Map()
  for (const token of colors) {
    const key = pairKey(token.light, token.dark)
    const list = index.get(key) ?? []
    list.push(token)
    index.set(key, list)
  }
  return index
}

/** Token priority for a role (`text`, `stroke`, other roles count as fill); without a priority it goes last. */
function rank(role, token) {
  return token.priority?.[role === 'text' || role === 'stroke' ? role : 'fill'] ?? Infinity
}

function compare(role) {
  // `Infinity - Infinity` yields NaN: it is falsy, so the comparison moves on to the path length, as with equal
  // priority.
  return (a, b) => rank(role, a) - rank(role, b) || a.id.length - b.id.length || a.id.localeCompare(b.id)
}

function pick(candidates, role, prefer) {
  const sorted = [...candidates].sort(compare(role))
  // With equal priority the group a neighbor is already bound to wins: the label of a primary button is
  // `primary.contrastText`.
  const best = rank(role, sorted[0])
  const kin = prefer ? sorted.find((token) => rank(role, token) === best && (token.group ?? '') === prefer) : undefined
  const chosen = kin ?? sorted[0]
  return { token: chosen.id, group: chosen.group ?? '', candidates: sorted.map((token) => token.id) }
}

/**
 * Token for a color pair and a role (`fill` | `text` | `stroke`); `prefer` is the token group of the
 * surroundings. A semi-transparent pair with the same alpha is bound to the opaque token with a fill `opacity`:
 * this is how the theme writes hover backdrops, `alpha(main, 0.08)`.
 * @returns {{ token: string, group: string, opacity?: number, candidates: string[] } | null}
 */
export function matchPair(index, light, dark, role, prefer) {
  const exact = index.get(pairKey(light, dark))
  if (exact && exact.length > 0) return pick(exact, role, prefer)
  // The alpha of the modes occasionally differs in the hundredths (`alpha(ink, .07)` vs `alpha(white, .08)`):
  // the light one is taken.
  if (light.a < 1 && Math.abs(light.a - dark.a) <= 0.02) {
    const opaque = index.get(pairKey({ ...light, a: 1 }, { ...dark, a: 1 }))
    if (opaque && opaque.length > 0) return { ...pick(opaque, role, prefer), opacity: light.a }
  }
  return null
}
