/*
 * Serialization of `svg` for `createNodeFromSvg`: `currentColor` is replaced with the computed color, the sizes
 * are explicit (Figma takes them from `width`/`height` or `viewBox`). Pseudo-element masks arrive as data URIs.
 */

const PAINT_PROPS = ['fill', 'stroke'] as const
const PLAIN_PROPS = [
  'stroke-width',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'fill-rule',
] as const
const TEXT_PROPS = ['font-size', 'font-weight', 'text-anchor', 'dominant-baseline'] as const

function hex(color: { r: number; g: number; b: number }): string {
  const part = (value: number) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`
}

function rgba(value: string): { r: number; g: number; b: number; a: number } | null {
  const match = /rgba?\(([^)]+)\)/.exec(value)
  if (!match) return null
  const [r, g, b, a] = match[1]
    .split(/[ ,/]+/)
    .filter(Boolean)
    .map((part) => parseFloat(part))
  return { r: r / 255, g: g / 255, b: b / 255, a: Number.isFinite(a) ? a : 1 }
}

/**
 * SVG for `createNodeFromSvg`. The computed styles of every element (fill, stroke, dashes, opacity, font on
 * `text`) are moved into attributes: the CSS of the classes will not reach Figma. A color equal to the root's
 * `currentColor` is written as the `tint` marker, the plugin recolors it; other colors stay as they are.
 */
export interface ISerializeOptions {
  /** CSS rotation or reflection (`[a, b, c, d]` of the matrix without translation) around the `viewBox` center. */
  rotation?: [number, number, number, number] | null
  /** Without `text` elements: text layers carry them. */
  skipText?: boolean
}

export function serializeSvg(
  element: SVGElement,
  tint: string,
  width: number,
  height: number,
  options: ISerializeOptions = {},
): string {
  const win = element.ownerDocument.defaultView
  const clone = element.cloneNode(true) as SVGElement
  const originals = [element, ...element.querySelectorAll('*')]
  const copies = [clone, ...clone.querySelectorAll('*')]
  const current = win ? rgba(win.getComputedStyle(element).color) : null
  const sameAsCurrent = (color: { r: number; g: number; b: number }) =>
    current !== null &&
    Math.abs(color.r - current.r) < 0.01 &&
    Math.abs(color.g - current.g) < 0.01 &&
    Math.abs(color.b - current.b) < 0.01
  // SVG default values and those inherited from the parent are not written: the markup stays short, and
  // identical glyphs are deduplicated.
  const initial: Record<string, string> = {
    stroke: 'none',
    'stroke-width': '1',
    'stroke-dasharray': 'none',
    'stroke-dashoffset': '0',
    'stroke-linecap': 'butt',
    'stroke-linejoin': 'miter',
    opacity: '1',
    'fill-opacity': '1',
    'stroke-opacity': '1',
    'fill-rule': 'nonzero',
  }
  const written = new Map<Element, Record<string, string>>()
  originals.forEach((original, index) => {
    const copy = copies[index]
    if (!copy || !win) return
    const style = win.getComputedStyle(original)
    const parent = original === element ? null : (written.get(original.parentElement as Element) ?? null)
    const values: Record<string, string> = {}
    const put = (prop: string, value: string, inherited: boolean) => {
      values[prop] = value
      const base = inherited && parent ? parent[prop] : initial[prop]
      if (value !== base && !(base === undefined && prop !== 'fill' && value === initial[prop]))
        copy.setAttribute(prop, value)
      else copy.removeAttribute(prop)
    }
    for (const prop of PAINT_PROPS) {
      const raw = style.getPropertyValue(prop)
      const color = raw && raw !== 'none' ? rgba(raw) : null
      if (!color || color.a === 0) {
        put(prop, 'none', true)
        continue
      }
      put(prop, sameAsCurrent(color) ? tint : hex(color), true)
      if (color.a < 1) put(`${prop}-opacity`, String(color.a), true)
    }
    for (const prop of PLAIN_PROPS) {
      const raw = style.getPropertyValue(prop)
      if (!raw || raw === 'normal') continue
      put(prop, raw.replace(/px\b/g, ''), prop !== 'opacity')
    }
    if (original.tagName.toLowerCase() === 'text') {
      for (const prop of TEXT_PROPS) {
        const value = style.getPropertyValue(prop)
        if (value) copy.setAttribute(prop, value.replace(/px\b/g, ''))
      }
    }
    written.set(original, { ...(parent ?? {}), ...values })
    copy.removeAttribute('class')
    copy.removeAttribute('style')
  })
  if (options.skipText) for (const text of clone.querySelectorAll('text')) text.remove()
  if (options.rotation) rotateContent(clone, options.rotation, width, height)
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  if (!clone.getAttribute('fill') || clone.getAttribute('fill') === 'currentColor') clone.setAttribute('fill', tint)
  if (!clone.hasAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  return clone.outerHTML.replaceAll('currentColor', tint)
}

/**
 * The `svg` content in a group with a rotation matrix around the `viewBox` center (the default CSS
 * `transform-origin` is the element center): a sort arrow with `rotate(180deg)` points the same way in Figma as
 * in the browser.
 */
function rotateContent(svg: SVGElement, [a, b, c, d]: [number, number, number, number], width: number, height: number) {
  const box = (svg.getAttribute('viewBox') ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((part) => parseFloat(part))
  const [x, y, w, h] = box.length === 4 && box.every(Number.isFinite) ? box : [0, 0, width, height]
  const cx = x + w / 2
  const cy = y + h / 2
  const round = (value: number) => Math.round(value * 1000) / 1000
  const group = svg.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'g')
  const e = cx - (a * cx + c * cy)
  const f = cy - (b * cx + d * cy)
  group.setAttribute('transform', `matrix(${[a, b, c, d, e, f].map(round).join(' ')})`)
  for (const child of [...svg.childNodes]) {
    // `defs` (gradients, masks) stay in place: references to them do not depend on the group.
    if (child instanceof Element && child.tagName.toLowerCase() === 'defs') continue
    group.append(child)
  }
  svg.append(group)
}

/** SVG from `mask-image: url("data:image/svg+xml,…")`; `null` if the mask is not an SVG. */
export function svgFromMask(maskImage: string): string | null {
  // Inside a double-quoted URI there are single quotes (`xmlns='…'`): only the matching quote is the boundary.
  const match = /url\("([^"]*)"\)|url\('([^']*)'\)|url\(([^)]*)\)/.exec(maskImage)
  const uri = match?.[1] ?? match?.[2] ?? match?.[3]
  if (!uri || !uri.startsWith('data:image/svg+xml')) return null
  const comma = uri.indexOf(',')
  const header = uri.slice(0, comma)
  const payload = uri.slice(comma + 1)
  try {
    return header.includes(';base64') ? atob(payload) : decodeURIComponent(payload)
  } catch {
    return null
  }
}

/** The mask as a filled outline: the color goes into `fill`, `viewBox` is kept, the sizes are the pseudo-element's. */
export function maskToSvg(markup: string, color: string, width: number, height: number): string {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const root = doc.documentElement
  if (root.nodeName !== 'svg') return markup
  root.setAttribute('width', String(width))
  root.setAttribute('height', String(height))
  root.setAttribute('fill', color)
  for (const shape of root.querySelectorAll('[fill]')) {
    if (shape.getAttribute('fill') !== 'none') shape.setAttribute('fill', color)
  }
  for (const shape of root.querySelectorAll('[stroke]')) {
    if (shape.getAttribute('stroke') !== 'none') shape.setAttribute('stroke', color)
  }
  return new XMLSerializer().serializeToString(root)
}

/** String hash for asset deduplication: FNV-1a, 32 bits, hexadecimal. */
export function hashString(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}
