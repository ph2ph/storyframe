// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { hashString, maskToSvg, serializeSvg, svgFromMask } from './svg'

const MASK =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 8'%3E%3Cpath d='M3.5 7L0.2 4'/%3E%3C/svg%3E\")"

describe('SVG for Figma', () => {
  it('a mask from a data URI with nested quotes is decoded and painted with the background color', () => {
    const markup = svgFromMask(MASK)
    expect(markup).toContain("viewBox='0 0 10 8'")
    const svg = maskToSvg(markup ?? '', 'rgb(242, 81, 61)', 9, 8)
    expect(svg).toContain('width="9"')
    expect(svg).toContain('height="8"')
    expect(svg).toContain('fill="rgb(242, 81, 61)"')
    expect(svgFromMask('url("data:image/png;base64,AAAA")')).toBeNull()
    expect(svgFromMask('none')).toBeNull()
  })

  it('an icon is serialized with a neutral color and explicit sizes', () => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    element.setAttribute('viewBox', '0 0 24 24')
    element.setAttribute('class', 'MuiSvgIcon-root')
    element.setAttribute('fill', 'currentColor')
    element.innerHTML = '<path d="M1 1h4" stroke="currentColor"/>'
    const markup = serializeSvg(element, '#000000', 18, 18)
    expect(markup).toContain('width="18"')
    expect(markup).not.toContain('currentColor')
    expect(markup).not.toContain('class=')
    expect(hashString(markup)).toMatch(/^[0-9a-f]{8}$/)
    expect(hashString(markup)).toBe(hashString(markup))
  })

  it('text is removed from the markup, the CSS rotation is written in as a group around the viewBox center', () => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    element.setAttribute('viewBox', '0 0 24 24')
    element.innerHTML = '<circle cx="12" cy="12" r="12"/><text x="12" y="12">1</text>'
    const markup = serializeSvg(element, '#000000', 24, 24, { rotation: [-1, 0, 0, -1], skipText: true })
    expect(markup).not.toContain('<text')
    expect(markup).toContain('<g transform="matrix(-1 0 0 -1 24 24)"><circle')
  })
})
