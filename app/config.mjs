/*
 * Entry point of `@ph2ph/storyframe/config`: a typing helper for the configuration. No Node modules, since
 * the configuration is also imported by the project's Storybook (the Variants block).
 */

/** @type {typeof import('./config.d.mts').defineConfig} */
export function defineConfig(config) {
  return config
}
