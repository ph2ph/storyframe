import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EMPTY_THEME, loadTheme } from './theme.ts'

let root: string

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'storyframe-theme-'))
  await mkdir(path.join(root, 'theme'))
  // A TypeScript theme module importing a sibling module: this is how a project writes its theme.
  await writeFile(path.join(root, 'theme/palette.ts'), `export const primary: string = '#1976d2'\n`)
  await writeFile(
    path.join(root, 'theme/index.ts'),
    `import { primary } from './palette'
export default async () => ({
  fonts: [{ family: 'Inter', weights: [400] }],
  colors: [{ id: 'primary', light: primary }],
  numbers: [],
  typography: [],
  shadows: [],
})\n`,
  )
  await writeFile(path.join(root, 'broken.ts'), `export default { colors: [] }\n`)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('loading the project theme', () => {
  it('without a module, the empty theme', async () => {
    expect(await loadTheme(root, null)).toBe(EMPTY_THEME)
  })

  it('TypeScript module with a function as the default export', async () => {
    const theme = await loadTheme(root, 'theme/index.ts')
    expect(theme.colors).toEqual([{ id: 'primary', light: '#1976d2' }])
  })

  it('a theme not in storyframe format fails with the violation paths', async () => {
    await expect(loadTheme(root, 'broken.ts')).rejects.toThrow(/broken\.ts не в формате storyframe:\n {2}fonts: /)
  })
})
