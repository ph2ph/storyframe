import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeConfig } from './catalog.mjs'
import { projectPaths } from './paths.mjs'

describe('пути проекта', () => {
  it('по умолчанию: сборка Storybook, выгрузка в ней, рабочая папка .storyframe', () => {
    const paths = projectPaths('/project', normalizeConfig())
    expect(paths.storybook).toBe(path.resolve('/project/storybook-static'))
    expect(paths.out).toBe(path.resolve('/project/storybook-static/figma-data'))
    expect(paths.shots.figma).toBe(path.resolve('/project/.storyframe/shots/figma'))
  })

  it('пути из конфигурации - от корня проекта', () => {
    const paths = projectPaths(
      '/project',
      normalizeConfig({ storybook: 'dist/sb', out: 'dist/figma', workDir: '.tmp/sf' }),
    )
    expect(paths.storybook).toBe(path.resolve('/project/dist/sb'))
    expect(paths.out).toBe(path.resolve('/project/dist/figma'))
    expect(paths.shots.diff).toBe(path.resolve('/project/.tmp/sf/shots/diff'))
  })
})
