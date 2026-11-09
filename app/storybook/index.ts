/*
 * Entry point of `@ph2ph/storyframe/storybook`: the Variants block for Storybook docs pages and a docs page
 * with it. Requires `@storybook/addon-docs`, `@storybook/react-vite` and the `storybook-addon-pseudo-states`
 * addon (hover and focus in the cells).
 */

export { isVariantsCell } from './cell'
export { createDocsPage } from './docsPage'
export { Variants } from './variants'
