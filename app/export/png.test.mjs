import { describe, expect, it } from 'vitest'
import { decodePng, encodePng } from './png.mjs'

describe('png', () => {
  it('кодирует и читает RGBA без потерь', () => {
    const width = 3
    const height = 2
    const data = new Uint8Array(width * height * 4).map((_, i) => (i * 37) % 256)
    const decoded = decodePng(encodePng({ width, height, data }))
    expect(decoded.width).toBe(3)
    expect(decoded.height).toBe(2)
    expect([...decoded.data]).toEqual([...data])
  })

  it('отвергает не PNG', () => {
    expect(() => decodePng(Buffer.from('hello'))).toThrow('Не PNG')
  })
})
