# AGENTS.md: storyframe

Export of a Storybook catalog for the Figma plugin (`app/export`), the Variants block for Storybook docs
(`app/storybook`), the MUI theme adapter (`app/mui`). User documentation is in `README.md`. The Figma plugin
lives in the `storyframe-plugin` repository and takes the export format, the matrix labels and the ZIP writer
from this package (entry points `./format`, `./variants`, `./zip`). This file is the single source of
instructions for agents.

## Commands

```bash
yarn test            # vitest: exporter, DOM converter (jsdom), MUI adapter
yarn typecheck       # tsc over the package
yarn lint            # oxlint
yarn format          # oxfmt; yarn format:check without writing
node bin/storyframe.mjs <command>   # CLI in the project folder: export, serve, shots-server, compare, emulate
```

Node 24 (`.nvmrc`): `.ts` sources run in Node itself without a build step. Definition of done: `typecheck`,
`lint`, `test`, `format:check`. A change of the export format is additionally checked in the plugin repository
against a real project export (`STORYFRAME_KIT=<project>/storybook-static/figma-data/kit.json yarn test`).

## Structure

- `bin/storyframe.mjs` contains the CLI; every command is a module `app/export/*.mjs` with `main(argv, root)`.
- `app/export/paths.mjs`: the project root (the launch folder), paths from the configuration, the package root.
- `app/export/config.mjs` and `catalog.mjs`: the project configuration and the layout of the catalog into pages;
  `catalog.mjs` uses no Node modules because the Variants block reads it in the browser.
- `app/export/theme.mjs`: loading of the project theme module through Vite SSR and format validation;
  `app/theme.d.mts` describes the theme format; `tokens.mjs` builds the export tokens from the theme.
- `app/export/capture/*.ts`: the DOM to layer tree converter, built by esbuild and injected into the Storybook
  page; `capture/types.ts` is the export format shared by the exporter and the plugin; `schema.mjs` repeats it
  in valibot.
- `app/export/dataset.mjs`: the export orchestrator, that is the plan (`plan.mjs`, `discover.mjs`, `matrix.mjs`),
  capture (`capture.mjs`), combining of modes and binding to tokens (`merge.mjs`, `colorMatch.mjs`), merging of
  indistinguishable variants (`dedupe.mjs`), instances (`signatures.mjs`), invariants (`invariants.mjs`).
- `app/storybook`: the Variants block and the docs page; the matrices are built by `app/export/docsMatrix.mjs`
  by the same rules as the export.

## Rules

- The package knows no projects. Knowledge about a specific catalog (pages, component sets, exclusions, token
  names, fonts) lives in the configuration and the theme module of the project; a new difference between
  projects is a configuration or adapter option, not a literal in the code. Token conventions (color priorities
  and groups, text colors, the full-circle corner radius, the code hint) are stored in the token fields of the
  theme and filled by the adapter.
- The export format changes in lockstep across `capture/types.ts`, `schema.mjs` and the plugin; an incompatible
  change bumps `SCHEMA_VERSION`.
- Identifiers, comments and docs in English. Russian stays only in runtime strings that the users of a kit see.
- Comments are about implementation nuances and Storybook and MUI specifics, without retelling the code.
- Prose avoids dashes: prefer a full sentence, a colon or a conjunction.
- Heavy runs (export, emulation, comparison) keep Chrome and thousands of screenshots in memory: one at a time,
  with `--tabs 2` on a machine without spare memory.
