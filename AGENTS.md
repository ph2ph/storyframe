# AGENTS.md: storyframe

Export of a Storybook catalog for the Figma plugin (`app/export`), the Variants block for Storybook docs
(`app/storybook`), the MUI theme adapter (`app/mui`). User documentation is in `README.md`. The Figma plugin
lives in the `storyframe-plugin` repository and takes the export format, the matrix labels and the ZIP writer
from this package (entry points `./format`, `./variants`, `./zip`). This file is the single source of
instructions for agents.

## Commands

```bash
yarn build           # tsc -p tsconfig.build.json into dist/ (what ships to npm; portal consumers use it too)
yarn test            # vitest over the sources: exporter, DOM converter (jsdom), MUI adapter
yarn typecheck       # tsc over the package without emit
yarn lint            # oxlint
yarn format          # oxfmt; yarn format:check without writing
node bin/storyframe.ts <command>    # CLI from the sources, in the project folder: export, serve, shots-server, compare, emulate
```

Node 24 (`.nvmrc`): the `.ts` sources run in Node itself during development, tests run on the sources. The
package ships `dist/` only: Node refuses to strip types under `node_modules`, so the build rewrites relative
`.ts` imports to `.js` (`rewriteRelativeImportExtensions`). Definition of done: `typecheck`, `lint`, `test`,
`format:check`, `build`; after a change run `yarn build` so that the kit and the plugin, linked through
`portal:`, see it. A change of the export format is additionally checked in the plugin repository
against a real project export (`STORYFRAME_KIT=<project>/storybook-static/figma-data/kit.json yarn test`).

## Release

GitHub Actions run the definition of done on every push to `main` and on pull requests
(`.github/workflows/ci.yml`). A version is published by `.github/workflows/publish.yml` on a pushed tag `vX.Y.Z`
through npm trusted publishing: no npm token in the repository, provenance attached by npm. Steps: the version in
`package.json` and a `## X.Y.Z, <date>` section in `CHANGELOG.md` in one commit on `main`, then
`git tag vX.Y.Z && git push origin main vX.Y.Z`. The workflow refuses a tag that differs from the version in
`package.json`. The trusted publisher on npmjs.com (package settings) names the repository `ph2ph/storyframe` and
the workflow file `publish.yml` and allows `npm publish`; renaming the workflow breaks publishing.

## Structure

- `bin/storyframe.ts` contains the CLI; every command is a module `app/export/*.ts` with `main(argv, root)`,
  loaded through a dynamic import with a literal path so that the build can rewrite the extension.
- `app/export/paths.ts`: the project root (the launch folder), paths from the configuration, the package root.
- `app/export/config.ts` and `catalog.ts`: the project configuration and the layout of the catalog into pages;
  `catalog.ts` uses no Node modules because the Variants block reads it in the browser.
- `app/export/theme.ts`: loading of the project theme module through Vite SSR and format validation;
  `app/theme.ts` describes the theme format; `tokens.ts` builds the export tokens from the theme.
- `app/export/capture/*.ts`: the DOM to layer tree converter, built by esbuild and injected into the Storybook
  page; `capture/types.ts` is the export format shared by the exporter and the plugin; `schema.ts` repeats it
  in valibot. The capture entry for esbuild follows the extension of the running file: `.ts` from the sources,
  `.js` from `dist/`.
- `app/export/dataset.ts`: the export orchestrator, that is the plan (`plan.ts`, `discover.ts`, `matrix.ts`),
  capture (`capture.ts`), combining of modes and binding to tokens (`merge.ts`, `colorMatch.ts`), merging of
  indistinguishable variants (`dedupe.ts`), instances (`signatures.ts`), invariants (`invariants.ts`).
- `app/storybook`: the Variants block and the docs page; the matrices are built by `app/export/docsMatrix.ts`
  by the same rules as the export.

## Rules

- The package knows no projects. Knowledge about a specific catalog (pages, component sets, exclusions, token
  names, fonts) lives in the configuration and the theme module of the project; a new difference between
  projects is a configuration or adapter option, not a literal in the code. Token conventions (color priorities
  and groups, text colors, the full-circle corner radius, the code hint) are stored in the token fields of the
  theme and filled by the adapter.
- The export format changes in lockstep across `capture/types.ts`, `schema.ts` and the plugin; an incompatible
  change bumps `SCHEMA_VERSION`.
- Identifiers, comments and docs in English. Russian stays only in runtime strings that the users of a kit see.
- Comments are about implementation nuances and Storybook and MUI specifics, without retelling the code.
- Prose avoids dashes: prefer a full sentence, a colon or a conjunction.
- Heavy runs (export, emulation, comparison) keep Chrome and thousands of screenshots in memory: one at a time,
  with `--tabs 2` on a machine without spare memory.
