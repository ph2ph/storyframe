import { describe, expect, it } from 'vitest'
import { compareImages, triptych } from './compare.mjs'

const image = (width, height, rgba) => ({
  width,
  height,
  data: new Uint8Array(width * height * 4).map((_, i) => rgba[i % 4]),
})

describe('сверка снимков', () => {
  it('считает долю отличающихся пикселей по пересечению и разницу размеров', () => {
    const reference = image(4, 4, [255, 0, 0, 255])
    const candidate = image(4, 2, [255, 0, 0, 255])
    candidate.data.set([0, 0, 255, 255], 0)
    const { mismatch, sizeDelta, diff } = compareImages(reference, candidate)
    expect(mismatch).toBeCloseTo(1 / 8, 5)
    expect(sizeDelta).toEqual([0, -2])
    expect(diff.width).toBe(4)
    expect(diff.height).toBe(4)
    expect(triptych(reference, candidate, diff).width).toBe(4 + 4 + 4 + 16)
  })

  it('прозрачный экспорт Figma сравнивается поверх белого', () => {
    const reference = image(2, 2, [255, 255, 255, 255])
    const candidate = image(2, 2, [0, 0, 0, 0])
    expect(compareImages(reference, candidate).mismatch).toBe(0)
  })
})
