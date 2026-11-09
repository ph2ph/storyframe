import { describe, expect, it } from 'vitest'
import {
  brighten,
  colorKey,
  firstFamily,
  isCollapsedTransform,
  parseBackdropBlur,
  parseBoxShadow,
  parseBrightness,
  parseColor,
  parseLinearGradient,
  parseRadius,
  splitTopLevel,
} from './css'

describe('CSS parsing', () => {
  it('colors: hex, rgb, rgba, short forms, transparent', () => {
    expect(parseColor('#403e3c')).toEqual({ r: 0.251, g: 0.2431, b: 0.2353, a: 1 })
    expect(parseColor('#fff')).toEqual({ r: 1, g: 1, b: 1, a: 1 })
    expect(parseColor('#00000080')?.a).toBeCloseTo(0.502, 3)
    expect(parseColor('rgb(64, 62, 60)')).toEqual(parseColor('#403e3c'))
    expect(parseColor('rgba(54, 50, 47, 0.08)')).toEqual({ r: 0.2118, g: 0.1961, b: 0.1843, a: 0.08 })
    expect(parseColor('rgba(220,34,11,.10)')?.a).toBe(0.1)
    expect(parseColor('rgb(0 0 0 / 0.5)')?.a).toBe(0.5)
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    expect(parseColor('radial-gradient(#fff, #000)')).toBeNull()
    expect(parseColor('currentColor')).toBeNull()
    expect(colorKey({ r: 0.251, g: 0.2431, b: 0.2353, a: 1 })).toBe('64,62,60,1')
  })

  it('shadows: several layers, inset, color first and last', () => {
    const effects = parseBoxShadow('inset 1px 2px 0 rgba(54, 50, 47, 0.2), rgb(0, 0, 0) 0px 2px 10px -1px')
    expect(effects).toHaveLength(2)
    expect(effects[0]).toMatchObject({ type: 'inner', offset: { x: 1, y: 2 }, blur: 0, spread: 0 })
    expect(effects[1]).toMatchObject({ type: 'drop', offset: { x: 0, y: 2 }, blur: 10, spread: -1 })
    expect(parseBoxShadow('none')).toEqual([])
  })

  it('radii, brightness, blur, gradient, family', () => {
    expect(parseRadius('11px', 80, 32)).toBe(11)
    expect(parseRadius('50%', 24, 24)).toBe(12)
    expect(parseBrightness('brightness(1.08)')).toBe(1.08)
    expect(parseBrightness('brightness(90%)')).toBe(0.9)
    expect(parseBrightness('none')).toBeNull()
    expect(brighten({ r: 0.5, g: 1, b: 0, a: 0.5 }, 1.1)).toEqual({ r: 0.55, g: 1, b: 0, a: 0.5 })
    expect(parseBackdropBlur('blur(3px)')).toBe(3)
    const gradient = parseLinearGradient('linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)')
    expect(gradient?.angle).toBe(90)
    expect(gradient?.stops.map((stop) => stop.pos)).toEqual([0, 1])
    expect(parseLinearGradient('linear-gradient(to right, #fff, #000)')?.stops[1]).toEqual({
      pos: 1,
      color: parseColor('#000'),
    })
    expect(parseLinearGradient('radial-gradient(#fff, #000)')).toBeNull()
    expect(firstFamily('Manrope, system-ui, -apple-system, "Segoe UI", sans-serif')).toBe('Manrope')
    expect(firstFamily('"JetBrains Mono", ui-monospace')).toBe('JetBrains Mono')
    expect(splitTopLevel('a, rgba(1, 2, 3, 0.5) b, c')).toEqual(['a', 'rgba(1, 2, 3, 0.5) b', 'c'])
  })

  it('transform that collapsed the element: scale(0) and squeeze along one axis, but not rotation', () => {
    // translateY(-100%) scale(0) of a closed slider value tooltip.
    expect(isCollapsedTransform('matrix(0, 0, 0, 0, 0, -32)')).toBe(true)
    expect(isCollapsedTransform('matrix(1, 0, 0, 0, 0, 0)')).toBe(true)
    expect(isCollapsedTransform('matrix(0.707107, 0.707107, -0.707107, 0.707107, 0, 0)')).toBe(false)
    expect(isCollapsedTransform('matrix(0.75, 0, 0, 0.75, 0, 0)')).toBe(false)
    expect(isCollapsedTransform('none')).toBe(false)
  })
})
