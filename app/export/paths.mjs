/*
 * Project and package paths. The project is the folder the command is run from (it holds the configuration,
 * the Storybook static build and the work folder); the package is storyframe itself (the DOM converter injected
 * into the Storybook page).
 */

import path from 'node:path'
import { loadConfig } from './config.mjs'

/** Root of the storyframe package. */
export const PACKAGE_ROOT = path.resolve(import.meta.dirname, '../..')

/**
 * @param {string} root project root
 * @param {import('./catalog.mjs').TConfig} config
 */
export function projectPaths(root, config) {
  const storybook = path.resolve(root, config.storybook)
  const work = path.resolve(root, config.workDir)
  return {
    root,
    /** Storybook static build. */
    storybook,
    /** The export: `kit.json`, `kit.zip`, `index.json`. */
    out: config.out ? path.resolve(root, config.out) : path.join(storybook, 'figma-data'),
    work,
    /** Screenshots for comparison: browser references, Figma screenshots, plugin emulation and diff triptychs. */
    shots: {
      storybook: path.join(work, 'shots/storybook'),
      figma: path.join(work, 'shots/figma'),
      emulated: path.join(work, 'shots/emulated'),
      diff: path.join(work, 'shots/diff'),
    },
  }
}

/** Project configuration and paths from the `root` folder. */
export async function loadProject(root = process.cwd()) {
  const config = await loadConfig(root)
  return { config, paths: projectPaths(root, config) }
}
