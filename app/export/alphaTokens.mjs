/*
 * "Token + opacity" pairs in fills, strokes, shadows and text become separate color tokens with alpha: when
 * a bound fill is assigned, Figma resets its opacity to the variable's alpha, so "primary/main at 8 %" lives
 * only as its own variable `primary/main-08`.
 */

const round = (value) => Math.round(value * 10000) / 10000

export function alphaTokenId(token, opacity) {
  return `${token}@${opacity}`
}

function derive(base, opacity) {
  const percent = Math.round(opacity * 100)
  const withAlpha = (color) => ({ r: color.r, g: color.g, b: color.b, a: round(color.a * opacity) })
  const code = base.code ?? base.id
  return {
    id: alphaTokenId(base.id, opacity),
    name: `${base.name}-${String(percent).padStart(2, '0')}`,
    light: withAlpha(base.light),
    dark: withAlpha(base.dark),
    description: `${base.name} с непрозрачностью ${percent} %: alpha(${code}, ${opacity})`,
    ...(base.code === undefined ? {} : { code: alphaTokenId(base.code, opacity) }),
    // A semi-transparent text color is still a text color.
    ...(base.text === undefined ? {} : { text: base.text }),
  }
}

/**
 * Rewrites `{ token, opacity }` references to derived tokens (adding them to `bundle.tokens.colors`) and
 * removes fully transparent fills, strokes and shadows. Returns the added tokens.
 */
export function deriveAlphaTokens(bundle) {
  const byId = new Map(bundle.tokens.colors.map((token) => [token.id, token]))
  const added = new Map()
  const transparent = (ref) => Boolean(ref) && 'token' in ref && ref.opacity === 0
  const rewrite = (ref) => {
    if (!ref || !('token' in ref) || ref.opacity === undefined) return ref
    const base = byId.get(ref.token)
    if (!base) return ref
    if (ref.opacity >= 1) return { token: ref.token }
    const token = derive(base, ref.opacity)
    if (!added.has(token.id)) added.set(token.id, token)
    return { token: token.id }
  }
  const walk = (node) => {
    if (node.type === 'text' || node.type === 'svg') {
      if (node.color) node.color = rewrite(node.color)
      if (node.type === 'text' && node.decorationColor) node.decorationColor = rewrite(node.decorationColor)
      return
    }
    if (node.type !== 'frame') return
    node.fills = node.fills
      .filter((paint) => !(paint.kind === 'solid' && transparent(paint.color)))
      .map((paint) =>
        paint.kind === 'solid'
          ? { ...paint, color: rewrite(paint.color) }
          : { ...paint, stops: paint.stops.map((stop) => ({ ...stop, color: rewrite(stop.color) })) },
      )
    if (node.stroke) {
      if (transparent(node.stroke.color)) delete node.stroke
      else {
        node.stroke.color = rewrite(node.stroke.color)
        if (node.stroke.paint) {
          node.stroke.paint = {
            ...node.stroke.paint,
            stops: node.stroke.paint.stops.map((stop) => ({ ...stop, color: rewrite(stop.color) })),
          }
        }
      }
    }
    node.effects = node.effects
      .filter((effect) => effect.type === 'backgroundBlur' || !transparent(effect.color))
      .map((effect) => (effect.type === 'backgroundBlur' ? effect : { ...effect, color: rewrite(effect.color) }))
    for (const child of node.children) walk(child)
  }
  for (const component of bundle.components) for (const variant of component.variants) walk(variant.tree)
  for (const story of bundle.stories ?? []) walk(story.tree)
  const tokens = [...added.values()].sort((a, b) => a.id.localeCompare(b.id))
  bundle.tokens.colors.push(...tokens)
  return tokens
}
