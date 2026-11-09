/*
 * Привязка цветов слоёв к токенам палитры по паре значений обоих режимов (design, решение 3): совпадение
 * только в одном режиме обманчиво, а пара однозначна. Несколько токенов с одной парой - выбор по приоритету
 * токена для роли краски и затем по длине адреса, порядок детерминирован. Приоритеты и группы задаёт тема
 * (адаптер): ядро не знает, как устроены адреса токенов проекта.
 */

import { colorKey } from './capture/css.ts'

export function pairKey(light, dark) {
  return `${colorKey(light)}|${colorKey(dark)}`
}

/** Индекс пар палитры: ключ пары → токены в порядке выгрузки. */
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

/** Приоритет токена для роли (`text`, `stroke`, остальные роли - как заливка); без приоритета - после всех. */
function rank(role, token) {
  return token.priority?.[role === 'text' || role === 'stroke' ? role : 'fill'] ?? Infinity
}

function compare(role) {
  // `Infinity - Infinity` даёт NaN: он ложен, и сравнение переходит к длине адреса, как при равном приоритете.
  return (a, b) => rank(role, a) - rank(role, b) || a.id.length - b.id.length || a.id.localeCompare(b.id)
}

function pick(candidates, role, prefer) {
  const sorted = [...candidates].sort(compare(role))
  // При равном приоритете побеждает группа, к которой уже привязан сосед: подпись primary-кнопки -
  // `primary.contrastText`.
  const best = rank(role, sorted[0])
  const kin = prefer ? sorted.find((token) => rank(role, token) === best && (token.group ?? '') === prefer) : undefined
  const chosen = kin ?? sorted[0]
  return { token: chosen.id, group: chosen.group ?? '', candidates: sorted.map((token) => token.id) }
}

/**
 * Токен для пары цветов и роли (`fill` | `text` | `stroke`); `prefer` - группа токенов окружения.
 * Полупрозрачная пара с одинаковой альфой привязывается к непрозрачному токену с `opacity` заливки:
 * так в теме записаны подложки наведения `alpha(main, 0.08)`.
 * @returns {{ token: string, group: string, opacity?: number, candidates: string[] } | null}
 */
export function matchPair(index, light, dark, role, prefer) {
  const exact = index.get(pairKey(light, dark))
  if (exact && exact.length > 0) return pick(exact, role, prefer)
  // Альфа режимов изредка расходится на сотые (`alpha(ink, .07)` против `alpha(white, .08)`): берётся светлая.
  if (light.a < 1 && Math.abs(light.a - dark.a) <= 0.02) {
    const opaque = index.get(pairKey({ ...light, a: 1 }, { ...dark, a: 1 }))
    if (opaque && opaque.length > 0) return { ...pick(opaque, role, prefer), opacity: light.a }
  }
  return null
}
