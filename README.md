# storyframe

Design system in Figma from a Storybook catalog. The package has two parts:

- **Export** (`storyframe export`): headless Chrome opens a Storybook static build, captures stories into a layer
  tree (auto layout, fills, strokes, shadows, text, SVG) and assembles `kit.json` and `kit.zip` together with the
  project theme tokens.
- **The Variants block** for Storybook docs pages: the same component sets, axes and states as in Figma, so that
  the examples in the catalog and in the file match.

The export is read by the storyframe Figma plugin. It lives in a separate repository, `storyframe-plugin`, and
builds from the export native Light/Dark variables, text and effect styles, component sets with variants and
stories as frames; a repeated run updates the file in place. The plugin takes the export format from this package,
so the exporter and the plugin always speak the same language.

The package knows nothing about a specific catalog: pages, component sets with custom axes and the theme are
defined in the project.

## Requirements

- Node 24 (not lower than 22.22.1): the project configuration and theme module are TypeScript files that Node
  executes itself. The package ships compiled JavaScript with declarations in `dist/`.
- A Storybook 10 static build (`storybook build`) with React and Vite.
- Chrome or Chromium for capture: `google-chrome` by default, another path via the `CHROME` variable.
- Vite in the project if a theme module is set (it is loaded through Vite SSR).

## Installation

The package is published on npmjs as `@ph2ph/storyframe`, the CLI command is called `storyframe`:

```bash
yarn add -D @ph2ph/storyframe
```

## Configuration

`storyframe.config.ts` (or `.mjs`) in the project root. Without the file the export builds a page for every
top-level section of the catalog and finds component sets on its own by the root class `<Prefix><Name>-root`.

```ts
import { defineConfig } from '@ph2ph/storyframe/config'

export default defineConfig({
  // Paths are relative to the project root; the values below are the defaults.
  storybook: 'storybook-static',
  out: 'storybook-static/figma-data',
  workDir: '.storyframe',
  // Theme module: without it the export runs without variables and styles.
  theme: './storyframe.theme.ts',
  storyUrl: 'https://storybook.example.com',
  pages: [
    { id: 'components', name: 'Components', include: ['Components', 'Components MUI'] },
    { id: 'icons', name: 'Icons', include: ['Components/Icons'] },
  ],
  exclude: ['Internal'],
  skip: { Modal: 'portal: the content is rendered outside the story root' },
  components: [
    {
      id: 'Button',
      name: 'Inputs/Button',
      storyId: 'components-mui-inputs-button--basic',
      storyFile: 'src/Button.stories.tsx',
      root: '.MuiButton-root',
      axes: [
        { name: 'Variant', arg: 'variant' },
        { name: 'Color', arg: 'color', exclude: ['inherit'] },
      ],
      states: ['default', 'hover', 'disabled'],
      label: true,
    },
  ],
  unboundExceptions: { Button: 'contained background is a derived color darken(main)' },
  layout: { maxWidth: 1980 },
})
```

`.storyframe/` should be added to `.gitignore`.

## Theme

The default export of the theme module is a theme in the storyframe format (the `IStoryframeTheme` type from
`@ph2ph/storyframe/config`): an object or a function, possibly async. Values are in CSS, as the component theme
writes them: light and dark mode colors, corner radius and spacing numbers, text styles, shadows, the canvas glow,
fonts and the plugin decoration roles.

For MUI the format is built by an adapter:

```ts
import { muiTheme } from '@ph2ph/storyframe/mui'
import { darkTheme, lightTheme } from './src/theme'

export default () =>
  muiTheme({
    light: lightTheme,
    dark: darkTheme,
    fonts: [{ family: 'Inter', weights: [400, 500, 700] }],
    radii: { borderRadius: 'md' },
    shadowNames: { 1: 'soft', 2: 'raised' },
    extraTypography: [{ prefix: 'mono', fontFamily: '"JetBrains Mono", monospace', variants: ['body2'] }],
    canvas: 'palette.background.gradient',
    describe: (address) => (address === 'palette.primary.main' ? 'Action color' : undefined),
  })
```

Decoration roles (`canvas`, `text`, `textSecondary`, `textDisabled`, `divider`, `title`, `heading`,
`subheading`, `body`, `caption`) are token paths the plugin uses to draw the canvas, labels and documentation
frames. In the MUI adapter they point by default to `palette.background.default`, `palette.text.*`,
`palette.divider` and `typography` variants; the `roles` option overrides them.

Project token conventions also come from the theme, the core does not parse token paths:

- `code`: how the token is written in code (`theme.palette.primary.main`, `var(--color-primary)`): a hint in the
  description and the variable code syntax in Dev Mode;
- `group` and `priority` (colors): the choice among tokens with equal values: the lower priority for the paint
  role (`fill`, `text`, `stroke`) wins, on a tie the group of the neighboring layer, then the shorter token path;
- `text` (colors): a text color: the variable is offered to text and shapes, but not to frame fills;
- `circle` (corner radii): the full-circle corner radius: it binds to corners not smaller than half of the
  shorter side.

The MUI adapter fills them by MUI conventions (`MUI_COLOR_PRIORITY`, `MUI_TEXT_COLOR`). A palette with extensions
passes its own lists via the `colorPriority` and `textColor` options, and the full-circle corner radius key via
the `circleRadius` option.

## Commands

The command runs in the project folder:

```bash
storyframe export [--only <substring>] [--tabs 4]  # export into <out>: kit.json, kit.zip, index.json
storyframe export --shots [folder]                 # the same plus reference PNGs for comparison
storyframe serve                                   # Storybook static build with CORS on localhost:6009
storyframe shots-server                            # receiver of screenshots from the plugin on localhost:6010
storyframe emulate [--only <substring>]            # plugin emulation in the browser: screenshots of kit.json layers
storyframe compare                                 # comparison of Figma (or emulation) screenshots with references
```

`--only` exports a part of the catalog for checking. Do not apply such an export to the working Figma file: the
plugin removes the folders and items missing from it (their component sets move to Deprecated, "Deprecated").

Capture keeps `--tabs` Chrome tabs open; on a machine without spare memory use `--tabs 2`.

## The Variants block in Storybook

Requires `@storybook/addon-docs` and the `storybook-addon-pseudo-states` addon (hover and focus in cells).

```tsx
// .storybook/preview.tsx
import { createDocsPage, isVariantsCell } from '@ph2ph/storyframe/storybook'
import config from '../storyframe.config'

export default {
  parameters: { docs: { page: createDocsPage(config) } },
  decorators: [
    (Story, context) => {
      // A matrix cell does not need the padding and background of a standalone story.
      const cell = isVariantsCell(context.parameters)
      return (
        <div style={{ padding: cell ? 0 : 24 }}>
          <Story />
        </div>
      )
    },
  ],
}
```

A custom docs page can be assembled from the `Variants` block with the `config` prop.

## The Figma plugin

The plugin is developed in the [storyframe-plugin](https://github.com/ph2ph/storyframe-plugin) repository: its
build, tests and the designer guide live there. This package gives the plugin shared code through three entry points:

- `@ph2ph/storyframe/format`: the export format types and `SCHEMA_VERSION`;
- `@ph2ph/storyframe/variants`: axis and state labels of the variant matrix, shared by Figma and the Variants
  block;
- `@ph2ph/storyframe/zip`: the ZIP writer the plugin uses to assemble its archive.

The export format changes in lockstep across `app/export/capture/types.ts`, `schema.ts` and the plugin code. An
incompatible change bumps `SCHEMA_VERSION`, and the plugin refuses to apply an export of another schema.

## Development

```bash
yarn build         # tsc into dist/: compiled JavaScript and declarations, the only thing that ships
yarn test          # vitest over the TypeScript sources: exporter, DOM converter, MUI adapter
yarn typecheck     # tsc over the package without emit
yarn lint
yarn format
```

The sources are TypeScript (`app/`, `bin/`) and run in Node directly during development. A project that links
the package from a sibling folder (`portal:`) uses `dist/`, so run `yarn build` after changes.

Checking the plugin against a real project export lives in the `storyframe-plugin` repository.

## License

MIT, the text is in the [LICENSE](LICENSE) file. The package can be used, modified and distributed in any
projects, including commercial ones, as long as the copyright notice is kept.
