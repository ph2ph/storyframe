import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { EMPTY_THEME, loadTheme } from './theme.mjs'

let root

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'storyframe-theme-'))
  await mkdir(path.join(root, 'theme'))
  // Модуль темы на TypeScript с импортом соседнего модуля: так тему пишет проект.
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

describe('загрузка темы проекта', () => {
  it('без модуля - пустая тема', async () => {
    expect(await loadTheme(root, null)).toBe(EMPTY_THEME)
  })

  it('модуль TypeScript с функцией по умолчанию', async () => {
    const theme = await loadTheme(root, 'theme/index.ts')
    expect(theme.colors).toEqual([{ id: 'primary', light: '#1976d2' }])
  })

  it('тема не в формате storyframe - ошибка с путями нарушений', async () => {
    await expect(loadTheme(root, 'broken.ts')).rejects.toThrow(/broken\.ts не в формате storyframe:\n {2}fonts: /)
  })
})
