/*
 * Configuration for tests: a catalog of the kit's own components and the MUI catalog on one page, icons on
 * a page of their own, the developer section kept out of the file, two component sets with custom axes.
 */

import type { IStoryframeConfig } from '../../config.ts'

const CHECKED = { false: { checked: false }, true: { checked: true } }

export default {
  pages: [
    { id: 'guideline', name: 'Гайдлайн', include: ['Гайдлайн'] },
    { id: 'components', name: 'Компоненты', include: ['Компоненты', 'Компоненты MUI'] },
    { id: 'icons', name: 'Иконки', include: ['Компоненты/Иконки'] },
  ],
  exclude: ['MCP'],
  components: [
    {
      id: 'Button',
      name: 'Inputs/Button',
      storyId: 'компоненты-mui-inputs-button--basic',
      storyFile: 'src/Button.stories.tsx',
      root: '.MuiButton-root',
      axes: [
        { name: 'Variant', arg: 'variant' },
        { name: 'Color', arg: 'color', exclude: ['inherit'] },
        { name: 'Size', arg: 'size' },
      ],
      states: ['default', 'hover', 'disabled'],
      label: true,
    },
    {
      id: 'Checkbox',
      name: 'Inputs/Checkbox',
      storyId: 'компоненты-mui-inputs-checkbox--basic',
      storyFile: 'src/Checkbox.stories.tsx',
      root: '.MuiCheckbox-root',
      axes: [
        { name: 'Variant', arg: 'variant' },
        { name: 'Color', arg: 'color', exclude: ['default'] },
        { name: 'Size', arg: 'size', exclude: ['large'] },
        { name: 'Checked', values: { ...CHECKED, indeterminate: { checked: false, indeterminate: true } } },
      ],
      states: ['default', 'hover', 'disabled'],
    },
  ],
} satisfies IStoryframeConfig
