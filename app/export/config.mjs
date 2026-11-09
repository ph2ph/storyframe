/*
 * Export configuration of storyframe (`storyframe.config.ts` or `.mjs` in the project root). Without the file:
 * a page per top-level section of the catalog in its order, no skips and no special component sets. The rules
 * are common to any Storybook: knowledge about a specific catalog lives only in its configuration. The layout
 * of the catalog across pages is in `catalog.mjs` (without Node modules) and is re-exported from here.
 */

import { access } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { normalizeConfig } from './catalog.mjs'

export * from './catalog.mjs'

/** Configuration file names in lookup order; `.ts` is read by Node itself, stripping the types. */
export const CONFIG_FILES = [
  'storyframe.config.ts',
  'storyframe.config.mts',
  'storyframe.config.mjs',
  'storyframe.config.js',
]

/** The configuration file in the project root, or `null`. */
export async function findConfig(root) {
  for (const name of CONFIG_FILES) {
    const file = path.join(root, name)
    const exists = await access(file).then(
      () => true,
      () => false,
    )
    if (exists) return file
  }
  return null
}

/** Configuration from the project root; without the file, the defaults. */
export async function loadConfig(root) {
  const file = await findConfig(root)
  if (!file) return normalizeConfig()
  const module = await import(pathToFileURL(file).href)
  return normalizeConfig(module.default)
}
