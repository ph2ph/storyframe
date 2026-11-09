/*
 * Конфигурация выгрузки storyframe (`storyframe.config.ts` или `.mjs` в корне проекта). Без файла - страница на
 * каждый раздел верхнего уровня каталога в его порядке, пропусков и особых наборов нет. Правила общие для
 * любого Storybook: знания о конкретном каталоге живут только в его конфигурации. Раскладка каталога по
 * страницам - в `catalog.mjs` (без модулей Node), отсюда она реэкспортируется.
 */

import { access } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { normalizeConfig } from './catalog.mjs'

export * from './catalog.mjs'

/** Имена файла конфигурации по порядку поиска; `.ts` Node читает сам, вырезая типы. */
export const CONFIG_FILES = [
  'storyframe.config.ts',
  'storyframe.config.mts',
  'storyframe.config.mjs',
  'storyframe.config.js',
]

/** Файл конфигурации в корне проекта или `null`. */
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

/** Конфигурация из корня проекта; нет файла - значения по умолчанию. */
export async function loadConfig(root) {
  const file = await findConfig(root)
  if (!file) return normalizeConfig()
  const module = await import(pathToFileURL(file).href)
  return normalizeConfig(module.default)
}
