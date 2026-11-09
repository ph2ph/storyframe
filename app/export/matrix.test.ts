import { describe, expect, it } from 'vitest'
import config from './fixtures/config.ts'
import { buildMatrix, checkMatrix } from './matrix.ts'

const REGISTRY = config.components

const BUTTON_ARGTYPES = {
  variant: { options: ['contained', 'outlined', 'text'] },
  color: { options: ['inherit', 'primary', 'secondary', 'success', 'error', 'info', 'warning'] },
  size: { options: ['small', 'medium', 'large'] },
}

describe('variant matrix', () => {
  it('button: product of axes without inherit and with the State axis', () => {
    // The fixture holds both entries.
    const button = REGISTRY.find((entry) => entry.id === 'Button')!
    const { axes, samples } = buildMatrix(button, BUTTON_ARGTYPES)
    expect(axes.map((axis) => axis.name)).toEqual(['Variant', 'Color', 'Size', 'State'])
    expect(samples).toHaveLength(3 * 6 * 3 * 3)
    const hover = samples.find((sample) => sample.key === 'Variant=contained, Color=primary, Size=medium, State=hover')
    expect(hover?.args).toEqual({ variant: 'contained', color: 'primary', size: 'medium' })
    expect(hover?.state.pseudo).toEqual(['hover'])
    const disabled = samples.find((sample) => sample.variant.State === 'disabled')
    expect(disabled?.args.disabled).toBe(true)
    expect(checkMatrix(button, samples)).toEqual([])
  })

  it('a component without axes gets the State axis with a single state', () => {
    const entry = { id: 'Plain', axes: [], states: ['default'], root: '.plain' }
    const { axes, samples } = buildMatrix(entry, {})
    expect(axes).toEqual([{ name: 'State', values: ['default'] }])
    expect(samples).toHaveLength(1)
    expect(samples[0].key).toBe('State=default')
    expect(samples[0].variant).toEqual({ State: 'default' })
  })

  it('a boolean axis takes args from the registry, an oversized matrix is a violation', () => {
    const checkbox = REGISTRY.find((entry) => entry.id === 'Checkbox')!
    const { samples } = buildMatrix(checkbox, {
      variant: { options: ['filled', 'outlined'] },
      color: { options: ['default', 'primary', 'secondary', 'success', 'error', 'info', 'warning'] },
      size: { options: ['small', 'medium', 'large'] },
    })
    expect(samples).toHaveLength(2 * 6 * 2 * 3 * 3)
    const indeterminate = samples.find((sample) => sample.variant.Checked === 'indeterminate')
    expect(indeterminate?.args).toMatchObject({ checked: false, indeterminate: true })
    expect(checkMatrix(checkbox, samples)).toEqual([])
    expect(checkMatrix(checkbox, [...samples, ...samples]).some((problem) => /дубль/.test(problem))).toBe(true)
    expect(
      checkMatrix(
        checkbox,
        Array.from({ length: 251 }, (_, i) => ({ key: String(i) })),
      )[0],
    ).toMatch(/больше 250/)
  })
})
