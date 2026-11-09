/*
 * Пути проекта и пакета. Проект - папка, из которой запущена команда (там конфигурация, сборка Storybook и
 * рабочая папка); пакет - сам storyframe (конвертер DOM для внедрения в страницу Storybook).
 */

import path from 'node:path'
import { loadConfig } from './config.mjs'

/** Корень пакета storyframe. */
export const PACKAGE_ROOT = path.resolve(import.meta.dirname, '../..')

/**
 * @param {string} root корень проекта
 * @param {import('./catalog.mjs').TConfig} config
 */
export function projectPaths(root, config) {
  const storybook = path.resolve(root, config.storybook)
  const work = path.resolve(root, config.workDir)
  return {
    root,
    /** Статическая сборка Storybook. */
    storybook,
    /** Выгрузка: `kit.json`, `kit.zip`, `index.json`. */
    out: config.out ? path.resolve(root, config.out) : path.join(storybook, 'figma-data'),
    work,
    /** Снимки для сверки: эталоны из браузера, снимки из Figma, эмуляция плагина и триптихи разницы. */
    shots: {
      storybook: path.join(work, 'shots/storybook'),
      figma: path.join(work, 'shots/figma'),
      emulated: path.join(work, 'shots/emulated'),
      diff: path.join(work, 'shots/diff'),
    },
  }
}

/** Конфигурация и пути проекта из папки `root`. */
export async function loadProject(root = process.cwd()) {
  const config = await loadConfig(root)
  return { config, paths: projectPaths(root, config) }
}
