# Changelog

## 0.1.0, unreleased

First version as a separate package. The export and the Variants block are extracted from the @a1s/react-ui UI kit
(there they lived in `scripts/figma` and `.storybook/variants.tsx`) and decoupled from it. The Figma plugin lives
in a separate repository, `storyframe-plugin`, and takes the export format from this package.

- The package is published on npmjs as `@ph2ph/storyframe`, the CLI command is called `storyframe`. MIT license.
- CLI `storyframe`: `export`, `serve`, `shots-server`, `compare`, `emulate`.
  The command runs in the project folder; the paths (`storybook`, `out`, `workDir`) come from the configuration.
- Configuration `storyframe.config.ts` or `.mjs`, the `defineConfig` helper from `@ph2ph/storyframe/config`.
- The project theme in a neutral format (`IStoryframeTheme`) from the `theme` module of the configuration, loaded
  through Vite SSR; the `@ph2ph/storyframe/mui` adapter builds it from `createTheme` themes.
- Plugin decoration roles in the theme: the plugin paints folder backgrounds, labels and documentation frames with
  theme tokens, not with the kit colors and fonts.
- Entry points for the plugin: `./format` (export format), `./variants` (matrix labels), `./zip` (ZIP writer).
- The Variants block: `createDocsPage(config)`, `Variants`, the cell parameter `storyframe.cell`
  (`isVariantsCell`).
- Project token conventions live in the theme, not in the core: the fields `code`, `group`, `priority`, `text`
  (colors) and `circle` (corner radii); the MUI adapter fills them itself and accepts `colorPriority`, `textColor`,
  `circleRadius` for palettes with extensions. The plugin preflight check warns about an export without these
  hints.
- Capture loads all font faces of the page before measuring text: the metrics no longer depend on the order of
  stories in a tab.
