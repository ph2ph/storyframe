import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeConfig } from './catalog.ts'
import { projectPaths } from './paths.ts'

describe('project paths', () => {
  it('defaults: the Storybook static build, the export inside it, the .storyframe work folder', () => {
    const paths = projectPaths('/project', normalizeConfig())
    expect(paths.storybook).toBe(path.resolve('/project/storybook-static'))
    expect(paths.out).toBe(path.resolve('/project/storybook-static/figma-data'))
    expect(paths.shots.figma).toBe(path.resolve('/project/.storyframe/shots/figma'))
  })

  it('paths from the configuration are resolved from the project root', () => {
    const paths = projectPaths(
      '/project',
      normalizeConfig({ storybook: 'dist/sb', out: 'dist/figma', workDir: '.tmp/sf' }),
    )
    expect(paths.storybook).toBe(path.resolve('/project/dist/sb'))
    expect(paths.out).toBe(path.resolve('/project/dist/figma'))
    expect(paths.shots.diff).toBe(path.resolve('/project/.tmp/sf/shots/diff'))
  })
})
