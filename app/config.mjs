/*
 * Точка входа `@ph2ph/storyframe/config`: помощник типизации конфигурации. Без модулей Node - конфигурацию
 * импортирует и Storybook проекта (блок «Варианты»).
 */

/** @type {typeof import('./config.d.mts').defineConfig} */
export function defineConfig(config) {
  return config
}
