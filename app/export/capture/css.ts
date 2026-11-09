/*
 * Parsing of CSS values into Figma units. The module is pure (no DOM, no Node): it is used both by the
 * converter in the catalog page and by the export builder in Node.
 */

import type { IRgba, TEffect } from './types'

const NAMED: Record<string, string> = { transparent: 'rgba(0, 0, 0, 0)', white: '#ffffff', black: '#000000' }

/** Channel rounding: Figma stores colors in 0–1, comparison uses a tolerance of half an 8-bit channel step. */
export function channel(value: number): number {
  return Math.round(value * 10000) / 10000
}

/**
 * CSS color → RGBA 0–1: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()` with commas or spaces,
 * `transparent`. Everything else (gradients, `currentColor`, names) gives `null`.
 */
export function parseColor(input: string | null | undefined): IRgba | null {
  if (!input) return null
  const text = NAMED[input.trim().toLowerCase()] ?? input.trim()
  const hex = /^#([0-9a-f]{3,8})$/i.exec(text)
  if (hex) {
    const digits = hex[1]
    if (![3, 4, 6, 8].includes(digits.length)) return null
    const wide = digits.length <= 4 ? [...digits].map((d) => d + d).join('') : digits
    const part = (i: number) => parseInt(wide.slice(i, i + 2), 16) / 255
    return {
      r: channel(part(0)),
      g: channel(part(2)),
      b: channel(part(4)),
      a: wide.length === 8 ? channel(part(6)) : 1,
    }
  }
  const rgb = /^rgba?\(\s*([^)]+)\)$/i.exec(text)
  if (rgb) {
    const parts = rgb[1]
      .replace('/', ' ')
      .split(/[\s,]+/)
      .filter(Boolean)
    if (parts.length < 3) return null
    const byte = (value: string) => (value.endsWith('%') ? parseFloat(value) / 100 : parseFloat(value) / 255)
    const alpha =
      parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
    const result = {
      r: channel(byte(parts[0])),
      g: channel(byte(parts[1])),
      b: channel(byte(parts[2])),
      a: channel(alpha),
    }
    return [result.r, result.g, result.b, result.a].every((v) => Number.isFinite(v)) ? result : null
  }
  return null
}

export function isTransparent(color: IRgba | null): boolean {
  return color === null || color.a === 0
}

export function sameColor(a: IRgba, b: IRgba, epsilon = 1 / 512): boolean {
  return (
    Math.abs(a.r - b.r) < epsilon &&
    Math.abs(a.g - b.g) < epsilon &&
    Math.abs(a.b - b.b) < epsilon &&
    Math.abs(a.a - b.a) < epsilon
  )
}

/** Color key for indexes: channels in 8 bits, alpha to thousandths. */
export function colorKey(color: IRgba): string {
  const byte = (v: number) => Math.round(v * 255)
  return `${byte(color.r)},${byte(color.g)},${byte(color.b)},${Math.round(color.a * 1000) / 1000}`
}

export function parsePx(value: string | null | undefined): number {
  if (!value) return 0
  const number = parseFloat(value)
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0
}

/** Splits a CSS list by top-level commas (commas inside `rgba()` do not count). */
export function splitTopLevel(input: string, separator = ','): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const char of input) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === separator && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else current += char
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/** Tokens of one shadow layer: the color may come first or last, `inset` anywhere. */
function shadowLayer(layer: string, color: (text: string) => IRgba | null): TEffect | null {
  const tokens = splitTopLevel(layer, ' ').filter(Boolean)
  const inset = tokens.includes('inset')
  const numbers: number[] = []
  let rgba: IRgba | null = null
  for (const token of tokens) {
    if (token === 'inset') continue
    const parsed = color(token)
    if (parsed) rgba = parsed
    else numbers.push(parsePx(token))
  }
  if (!rgba || numbers.length < 2) return null
  const [x, y, blur = 0, spread = 0] = numbers
  return { type: inset ? 'inner' : 'drop', color: { light: rgba, dark: rgba }, offset: { x, y }, blur, spread }
}

/** `box-shadow` → Figma effects (the color is a literal for both modes for now; the builder merges the modes). */
export function parseBoxShadow(value: string | null | undefined): TEffect[] {
  if (!value || value === 'none') return []
  return splitTopLevel(value)
    .map((layer) => shadowLayer(layer, parseColor))
    .filter((effect): effect is TEffect => effect !== null)
}

/** Radius of one corner: `px` or `%` of the smaller side (as the browser computes it for a circle). */
export function parseRadius(value: string, width: number, height: number): number {
  const first = value.trim().split(/\s+/)[0] ?? '0'
  if (first.endsWith('%')) return Math.round((parseFloat(first) / 100) * Math.min(width, height) * 100) / 100
  return parsePx(first)
}

/**
 * The computed `transform` collapses the element into a point or a line (`scale(0)` of a closed slider value
 * tooltip): the box is zero, but children and pseudo-elements keep their sizes from CSS.
 */
export function isCollapsedTransform(transform: string | null | undefined): boolean {
  const match = /matrix\(([^)]+)\)/.exec(transform ?? '')
  if (!match) return false
  const [a, b, c, d] = match[1].split(',').map((part) => parseFloat(part))
  return Math.abs(a * d - b * c) < 1e-6
}

/** Factor of `filter: brightness(k)`; `null` means there is no filter. */
export function parseBrightness(filter: string | null | undefined): number | null {
  const match = /brightness\(\s*([\d.]+)(%?)\s*\)/.exec(filter ?? '')
  if (!match) return null
  const value = parseFloat(match[1])
  return match[2] ? value / 100 : value
}

/** Applies brightness to a color: the channels are multiplied, alpha stays. */
export function brighten(color: IRgba, factor: number): IRgba {
  const clamp = (v: number) => channel(Math.min(1, Math.max(0, v * factor)))
  return { r: clamp(color.r), g: clamp(color.g), b: clamp(color.b), a: color.a }
}

/** Radius of `backdrop-filter: blur(n)`; `null` means there is no blur. */
export function parseBackdropBlur(filter: string | null | undefined): number | null {
  const match = /blur\(\s*([\d.]+)px\s*\)/.exec(filter ?? '')
  return match ? parseFloat(match[1]) : null
}

export interface ILinearGradient {
  angle: number
  stops: { pos: number; color: IRgba }[]
}

/**
 * `linear-gradient(90deg, c1 0%, c2 100%)` → angle and stops. Directions given as words (`to right`) are
 * converted to degrees; stops without a position are spread evenly. Other gradients give `null`.
 */
export function parseLinearGradient(value: string | null | undefined): ILinearGradient | null {
  const match = /^linear-gradient\((.*)\)$/s.exec((value ?? '').trim())
  if (!match) return null
  const parts = splitTopLevel(match[1])
  let angle = 180
  const first = parts[0] ?? ''
  if (/deg$/.test(first)) {
    angle = parseFloat(first)
    parts.shift()
  } else if (first.startsWith('to ')) {
    const sides: Record<string, number> = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270 }
    angle = sides[first] ?? 180
    parts.shift()
  }
  const stops = parts.map((part) => {
    const tokens = splitTopLevel(part, ' ')
    const color = parseColor(tokens[0]) ?? parseColor(tokens.slice(0, -1).join(' '))
    const position = tokens.find((token) => token.endsWith('%'))
    return { color, pos: position ? parseFloat(position) / 100 : NaN }
  })
  if (stops.some((stop) => stop.color === null) || stops.length < 2) return null
  return {
    angle,
    stops: stops.map((stop, i) => ({
      pos: Number.isNaN(stop.pos) ? i / (stops.length - 1) : stop.pos,
      color: stop.color as IRgba,
    })),
  }
}

/** Family from `font-family`: the first name without quotes. */
export function firstFamily(fontFamily: string | null | undefined): string {
  return (fontFamily ?? '')
    .split(',')[0]
    .trim()
    .replace(/^["']|["']$/g, '')
}
