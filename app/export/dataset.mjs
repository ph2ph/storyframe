/*
 * Builder of the export for Figma (`storyframe export`): tokens from the project theme, the Storybook catalog
 * laid out across the pages of the configuration (`storyframe.config.ts`), component sets from the args matrix
 * of the "Basic" story, the remaining stories as frames; merging of modes, binding to tokens, merging of
 * indistinguishable variants, invariants, writing `kit.json`, `kit.zip` and `index.json` to the export folder
 * (`<storybook>/figma-data` by default).
 *
 *   storyframe export [--only <title substring or id>] [--tabs 4] [--shots [directory]]
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { createReport, printReport } from '../lib/report.mjs'
import { deriveAlphaTokens } from './alphaTokens.mjs'
import { createCaptureSession } from './capture.mjs'
import { CONTENT_ROOT, SCHEMA_VERSION } from './capture/types.ts'
import { buildPairIndex } from './colorMatch.mjs'
import { layoutCatalog } from './config.mjs'
import { collapseIdentical } from './dedupe.mjs'
import { AUTO_MAX_VARIANTS, defaultValue, failedVariant, resolveAutoEntry, withoutValue } from './discover.mjs'
import { checkBundle, walkTree } from './invariants.mjs'
import { axisValues, buildMatrix, checkMatrix, variantKey } from './matrix.mjs'
import { bindRadii, createMergeReport, mergeTrees } from './merge.mjs'
import { loadProject } from './paths.mjs'
import { buildPages, planJobs } from './plan.mjs'
import { buildSignatureIndex, replaceInstances } from './signatures.mjs'
import { loadTheme } from './theme.mjs'
import { buildTokens } from './tokens.mjs'
import { createZip } from './zip.mjs'

/** Folder of reference screenshots of frame stories (`stories/<story id>.png`), as the Figma plugin names it. */
const STORIES_FOLDER = 'stories'

/** Storybook description Markdown → text: links `[text](url)` become "text: url". */
export function plainDescription(markdown) {
  return (markdown ?? '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1: $2')
    .replace(/[*_`]{1,2}([^*_`]+)[*_`]{1,2}/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Path of the tree's first text layer, the component set's `Label` property. */
function firstTextPath(tree) {
  if (tree.type === 'text') return tree.path
  if (tree.type !== 'frame') return null
  for (const child of tree.children) {
    const found = firstTextPath(child)
    if (found !== null) return found
  }
  return null
}

/** Axes of a discovered component set left with fewer than two values after exclusions do not form a matrix. */
function viableAxes(entry, argTypes) {
  return { ...entry, axes: entry.axes.filter((axis) => 'values' in axis || axisValues(axis, argTypes).length >= 2) }
}

/**
 * The value on which the capture of a discovered component set failed: the last pair in the key that differs
 * from the story default (the default is known to render), otherwise the last pair.
 */
function culprit(entry, message, initialArgs) {
  const failed = failedVariant(message)
  if (!failed) return null
  const pairs = Object.entries(failed).reverse()
  return pairs.find(([axis, value]) => defaultValue(entry, axis, initialArgs) !== value) ?? pairs[0]
}

const MAX_EXCLUSIONS = 8

/** Axis arg name: `arg` for an axis with a list, the first key of a value for an axis with ready-made args. */
function axisArg(axis) {
  return 'arg' in axis ? axis.arg : (Object.keys(Object.values(axis.values)[0] ?? {})[0] ?? null)
}

/**
 * Reference screenshots after the merging of indistinguishable variants: the merged-away variants are deleted,
 * the remaining ones are renamed to the new key (without the merged axes) so that `storyframe compare` finds
 * the match for a screenshot from Figma.
 */
async function renameShots(context, folder, renames, removed) {
  if (!context.shots) return
  const dir = path.join(context.shots, folder)
  const file = (key) => path.join(dir, `${key.replaceAll('/', '-')}.png`)
  for (const key of removed) await rm(file(key), { force: true })
  for (const [from, to] of renames) if (from !== to) await rename(file(from), file(to)).catch(() => {})
}

/**
 * Component set: the args matrix of the "Basic" story with state captures. `null` means the story has no
 * component root by class (a Guideline page, the icon catalog): then it is exported as a frame.
 */
async function exportComponent(entry, session, slotIndex, context) {
  const { argTypes, initialArgs, description } = await session.argTypes(entry.storyId, slotIndex)
  let resolved = entry.auto ? resolveAutoEntry(entry, argTypes) : entry
  if (resolved.dropped?.length > 0) {
    context.log(`${entry.id}: оси ${resolved.dropped.join(', ')} не вошли в предел ${AUTO_MAX_VARIANTS} вариантов`)
  }
  const root = resolved.root ?? (await session.resolveRoot(entry.storyId, entry.id, null, slotIndex))
  if (!root) return null
  let axes
  let samples
  let captured
  for (let exclusions = 0; ; exclusions += 1) {
    ;({ axes, samples } = buildMatrix({ ...(entry.auto ? viableAxes(resolved, argTypes) : resolved), root }, argTypes))
    for (const problem of checkMatrix(entry, samples)) context.report.violation(problem)
    try {
      captured = await session.shoot({ storyId: entry.storyId, root, name: entry.id, samples, slotIndex })
      break
    } catch (error) {
      // The story of a discovered component set may fail on a single value (`multiple` without an array, a
      // color outside the palette, an invisible root): the value is excluded and the set is captured again.
      const found = entry.auto && exclusions < MAX_EXCLUSIONS ? culprit(resolved, error.message, initialArgs) : null
      const next = found ? withoutValue(resolved, found[0], found[1]) : null
      if (!next) throw error
      resolved = next
      context.report.warning(`${entry.id}: значение ${found[0]}=${found[1]} исключено из набора - ${error.message}`)
      session.reset(slotIndex)
    }
  }
  const variants = []
  const keys = new Map()
  for (const sample of samples) {
    const shot = captured[sample.key]
    if (!shot?.light || !shot?.dark) {
      context.report.violation(`${entry.id}: нет снимка варианта ${sample.key}`)
      continue
    }
    Object.assign(context.assets, shot.light.assets)
    const tree = mergeTrees(
      context.pairIndex,
      context.merge,
      `${entry.id} ${sample.key}`,
      shot.light.tree,
      shot.dark.tree,
    )
    bindRadii(tree, context.tokens.numbers)
    const variant = {
      variant: { ...sample.variant },
      tree,
      signature: shot.light.signature,
      stretched: shot.light.stretched,
    }
    keys.set(variant, sample.key)
    variants.push(variant)
  }
  for (const axis of axes) {
    const source = resolved.axes.find((candidate) => candidate.name === axis.name)
    const text = source ? plainDescription(argTypes[axisArg(source)]?.description) : ''
    if (text) axis.description = text
  }
  const labelPath = resolved.label ? firstTextPath(variants[0]?.tree ?? { type: 'frame', children: [] }) : null
  const component = {
    id: entry.id,
    name: entry.name,
    description: [
      plainDescription(description),
      context.storyUrl(entry.storyId) && `История: ${context.storyUrl(entry.storyId)}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    storyUrl: context.storyUrl(entry.storyId),
    axes,
    textProps: labelPath === null ? [] : [{ name: 'Label', path: labelPath }],
    variants,
    dependsOn: entry.dependsOn ?? [],
  }
  // Variants identical in the design (behavior without appearance, container width) are merged.
  const defaults = Object.fromEntries(axes.map((axis) => [axis.name, defaultValue(resolved, axis.name, initialArgs)]))
  const before = new Set(component.variants)
  const collapsed = collapseIdentical(component, defaults)
  if (collapsed.length > 0) {
    component.collapsed = collapsed
    const kept = new Set(component.variants)
    await renameShots(
      context,
      entry.id,
      component.variants.map((variant) => [keys.get(variant), variantKey(variant.variant, component.axes)]),
      [...before].filter((variant) => !kept.has(variant)).map((variant) => keys.get(variant)),
    )
  }
  return { component, description: plainDescription(description) }
}

/** A story as a frame: the story content without wrappers, components inside become instances later. */
async function exportStory(story, session, slotIndex, context) {
  const sample = { key: story.id, args: {}, state: {} }
  const captured = await session.shoot({
    storyId: story.id,
    root: CONTENT_ROOT,
    name: story.name,
    samples: [sample],
    slotIndex,
    shotsFolder: STORIES_FOLDER,
  })
  const shot = captured[sample.key]
  if (!shot?.light || !shot?.dark) throw new Error('нет снимка')
  Object.assign(context.assets, shot.light.assets)
  const tree = mergeTrees(context.pairIndex, context.merge, story.id, shot.light.tree, shot.dark.tree)
  bindRadii(tree, context.tokens.numbers)
  return { id: story.id, name: story.name, storyUrl: context.storyUrl(story.id), tree }
}

async function exportAll(plan, context, tabs) {
  const session = await createCaptureSession({
    staticDir: context.storybook,
    tabs,
    log: context.log,
    shots: context.shots,
  })
  const components = new Map()
  const stories = new Map()
  const descriptions = new Map()
  const fallbacks = new Map()
  try {
    const queue = [
      ...plan.flatMap((planned) => planned.components.map((entry) => ({ kind: 'component', entry, planned }))),
      ...plan.flatMap((planned) => planned.frames.map((story) => ({ kind: 'story', story, planned }))),
    ]
    const workers = Array.from({ length: Math.min(tabs, queue.length) }, async (_, slot) => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const started = Date.now()
        const seconds = () => Math.round((Date.now() - started) / 1000)
        if (job.kind === 'component') {
          let result
          try {
            result = await exportComponent(job.entry, session, slot, context)
          } catch (error) {
            // A component set discovered in the catalog must not bring down the export: the story may have no
            // root in the DOM.
            if (!job.entry.auto) throw error
            session.reset(slot)
            context.report.warning(`${job.entry.id}: набор из каталога пропущен - ${error.message}`)
            result = null
          }
          if (!result) {
            // Without a component root the "Basic" story also goes as a frame (unless it is already a frame of
            // the item).
            if (job.entry.auto) {
              const story = context.storiesById.get(job.entry.storyId)
              if (story && !job.planned.frames.some((frame) => frame.id === story.id)) {
                fallbacks.set(job.planned.item.title, story.id)
                queue.push({ kind: 'story', story, planned: job.planned })
              }
            }
            continue
          }
          components.set(job.entry.id, result.component)
          if (result.description) descriptions.set(job.planned.item.title, result.description)
          context.log(`${job.entry.id}: ${result.component.variants.length} вариантов за ${seconds()} с`)
        } else {
          try {
            stories.set(job.story.id, await exportStory(job.story, session, slot, context))
          } catch (error) {
            session.reset(slot)
            context.report.warning(`${job.story.id}: история не выгружена - ${error.message}`)
            continue
          }
          context.log(`история ${job.story.id}: ${seconds()} с`)
        }
      }
    })
    await Promise.all(workers)
  } finally {
    await session.close()
  }
  return { components, stories, descriptions, fallbacks }
}

/** Instances inside variants (except the component itself) and stories; `dependsOn` is the plugin's build order. */
function linkInstances(components, stories, report) {
  const index = buildSignatureIndex(components)
  const outOfMatrix = []
  const kept = []
  for (const component of components) {
    const dependsOn = new Set(component.dependsOn)
    for (const variant of component.variants) {
      const where = `${component.id} ${variantLabel(variant.variant)}`
      const result = replaceInstances(variant.tree, index, { selfId: component.id, where })
      variant.tree = result.tree
      for (const id of result.dependsOn) dependsOn.add(id)
      outOfMatrix.push(...result.outOfMatrix)
      kept.push(...result.kept)
    }
    component.dependsOn = [...dependsOn]
  }
  for (const story of stories) {
    const result = replaceInstances(story.tree, index, { where: story.id })
    story.tree = result.tree
    outOfMatrix.push(...result.outOfMatrix)
    kept.push(...result.kept)
  }
  // Nodes resembling a variant missing from the matrix: one warning per "where → which component set" pair.
  const grouped = new Map()
  for (const entry of outOfMatrix) {
    const [where, rest] = entry.split(': ')
    const key = `${where.split(' ')[0]} → ${rest?.split(' ')[0] ?? '?'}`
    const group = grouped.get(key) ?? { count: 0, example: entry }
    group.count += 1
    grouped.set(key, group)
  }
  for (const [key, { count, example }] of grouped) {
    report.warning(`вне матрицы: ${key}: ${count} узлов, например ${example}`)
  }
  if (kept.length)
    process.stderr.write(
      `Оставлено слоями (отличается от варианта): ${kept.length}\n  ${kept.slice(0, 12).join('\n  ')}\n`,
    )
  return outOfMatrix
}

function allTrees(components, stories) {
  return [
    ...components.flatMap((component) =>
      component.variants.map((variant) => ({
        where: `${component.id} ${variantLabel(variant.variant)}`,
        tree: variant.tree,
      })),
    ),
    ...stories.map((story) => ({ where: story.id, tree: story.tree })),
  ]
}

/** Assets nobody references after the replacement with instances are removed from the export. */
function pruneAssets(assets, components, stories) {
  const used = new Set()
  for (const { tree } of allTrees(components, stories))
    for (const node of walkTree(tree)) if (node.type === 'svg') used.add(node.asset)
  for (const key of Object.keys(assets)) if (!used.has(key)) delete assets[key]
}

/** Color literals in the final trees (after the replacement with instances), grouped by value. */
function collectUnbound(components, stories) {
  const found = new Map()
  const note = (ref, where) => {
    if (!ref || 'token' in ref || ref.approx) return
    const key = `${JSON.stringify(ref.light)}|${JSON.stringify(ref.dark)}`
    const entry = found.get(key) ?? { light: ref.light, dark: ref.dark, count: 0, where: [] }
    entry.count += 1
    if (entry.where.length < 5 && !entry.where.includes(where)) entry.where.push(where)
    found.set(key, entry)
  }
  for (const { where, tree } of allTrees(components, stories)) {
    for (const node of walkTree(tree)) {
      const at = `${where}${node.path ? ` ${node.path}` : ''}`
      if (node.type === 'text' || node.type === 'svg') note(node.color, at)
      if (node.type === 'text') note(node.decorationColor, at)
      if (node.type !== 'frame') continue
      for (const paint of node.fills) {
        if (paint.kind === 'solid') note(paint.color, at)
        else for (const stop of paint.stops) note(stop.color, at)
      }
      if (node.stroke) note(node.stroke.color, at)
      for (const effect of node.effects) if (effect.type !== 'backgroundBlur') note(effect.color, at)
    }
  }
  return [...found.values()]
}

function toReport(merge) {
  return {
    unboundColors: [...merge.unbound.values()].map((entry) => ({
      light: entry.light,
      dark: entry.dark,
      count: entry.count,
      where: [...entry.where],
    })),
    ambiguousColors: [...merge.ambiguous.values()],
    outOfMatrix: [],
  }
}

function variantLabel(variant) {
  return Object.entries(variant)
    .map(([axis, value]) => `${axis}=${value}`)
    .join(', ')
}

function sortedRecord(record) {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)))
}

export async function main(argv = process.argv.slice(2), root = process.cwd()) {
  const { values } = parseArgs({
    args: argv,
    options: { only: { type: 'string' }, tabs: { type: 'string', default: '4' }, shots: { type: 'string' } },
  })
  const report = createReport()
  const { config, paths } = await loadProject(root)
  const indexFile = path.join(paths.storybook, 'index.json')
  const hasIndex = await readFile(indexFile).then(
    () => true,
    () => false,
  )
  if (!hasIndex) {
    process.stderr.write(
      `Нет ${path.relative(root, indexFile)}: сначала соберите статический Storybook (storybook build)\n`,
    )
    return 1
  }
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const { tokens, fonts, warnings } = buildTokens(await loadTheme(root, config.theme))
  for (const warning of warnings) report.warning(warning)

  const index = JSON.parse(await readFile(indexFile, 'utf8'))
  const storyEntries = Object.values(index.entries).filter((entry) => entry.type === 'story')
  const layout = layoutCatalog(storyEntries, config)
  const plan = planJobs(layout, storyEntries, config, values.only ?? null)
  const storyUrl = (storyId) => (config.storyUrl ? `${config.storyUrl}/?path=/story/${storyId}` : '')
  process.stderr.write(
    `Каталог: ${layout.length} страниц, ${plan.length} пунктов, ${plan.reduce((sum, item) => sum + item.components.length, 0)} наборов-кандидатов, ${plan.reduce((sum, item) => sum + item.frames.length, 0)} историй фреймами\n`,
  )
  const shots = values.shots === undefined ? null : path.resolve(root, values.shots || paths.shots.storybook)
  // Old references (past variant keys, vanished stories) only get in the way of the comparison.
  if (shots && !values.only) await rm(shots, { recursive: true, force: true })
  if (shots && values.only) {
    for (const planned of plan) {
      for (const entry of planned.components) await rm(path.join(shots, entry.id), { recursive: true, force: true })
    }
  }
  const context = {
    report,
    tokens,
    pairIndex: buildPairIndex(tokens.colors),
    merge: createMergeReport(),
    assets: {},
    log: (text) => process.stderr.write(`  ${text}\n`),
    storiesById: new Map(storyEntries.map((entry) => [entry.id, entry])),
    storyUrl,
    storybook: paths.storybook,
    // Reference PNGs of stories for the comparison with Figma (`storyframe compare`); without the flag the
    // capture does not make them.
    shots,
  }
  const started = Date.now()
  const tabs = Math.max(1, parseInt(values.tabs, 10) || 4)
  const results = await exportAll(plan, context, tabs)
  for (const mismatch of context.merge.mismatches) report.warning(mismatch)
  process.stderr.write(`Съёмка: ${Math.round((Date.now() - started) / 1000)} с\n`)
  const pages = buildPages(plan, results, storyUrl)
  const components = pages
    .flatMap((page) => page.sections.flatMap((section) => section.items))
    .filter((item) => item.component)
    .map((item) => results.components.get(item.component))
  const stories = pages
    .flatMap((page) => page.sections.flatMap((section) => section.items.flatMap((item) => item.stories)))
    .map((id) => results.stories.get(id))
  const outOfMatrix = linkInstances(components, stories, report)
  // The merged twins and the stretched root flag were needed only by the merging and the instance search.
  for (const component of components) {
    for (const variant of component.variants) {
      delete variant.aliases
      delete variant.stretched
    }
  }
  pruneAssets(context.assets, components, stories)
  const alphaTokens = deriveAlphaTokens({ tokens, components, stories })
  process.stderr.write(`Токены с альфой: ${alphaTokens.length}\n`)

  const bundle = {
    schema: SCHEMA_VERSION,
    kit: { name: packageJson.name, version: packageJson.version },
    builtAt: new Date().toISOString(),
    fonts,
    tokens,
    assets: { svg: sortedRecord(context.assets) },
    components,
    stories,
    pages,
    ...(config.layout ? { layout: config.layout } : {}),
    report: { ...toReport(context.merge), unboundColors: collectUnbound(components, stories), outOfMatrix },
  }
  // No indentation: the bundle is three times smaller, and it is read by the Figma plugin and the tests.
  const json = `${JSON.stringify(bundle)}\n`
  checkBundle(bundle, report, {
    unboundExceptions: config.unboundExceptions,
    bytes: Buffer.byteLength(json),
    strictIds: config.components.map((entry) => entry.id),
  })

  await mkdir(paths.out, { recursive: true })
  const zip = createZip([{ name: 'kit.json', data: json, date: new Date(bundle.builtAt) }])
  const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')
  await writeFile(path.join(paths.out, 'kit.json'), json)
  await writeFile(path.join(paths.out, 'kit.zip'), zip)
  await writeFile(
    path.join(paths.out, 'index.json'),
    `${JSON.stringify(
      {
        version: bundle.kit.version,
        schema: SCHEMA_VERSION,
        files: {
          'kit.json': { bytes: Buffer.byteLength(json), sha256: sha256(json) },
          'kit.zip': { bytes: zip.length, sha256: sha256(zip) },
        },
      },
      null,
      2,
    )}\n`,
  )
  const variants = components.reduce((sum, component) => sum + component.variants.length, 0)
  const collapsed = components.reduce(
    (sum, component) => sum + (component.collapsed ?? []).reduce((inner, entry) => inner + entry.values.length, 0),
    0,
  )
  process.stderr.write(
    `Выгрузка: ${tokens.colors.length} цветов, ${tokens.typography.length} стилей текста, ${pages.length} страниц, ${components.length} наборов, ${variants} вариантов (склеено значений: ${collapsed}), ${stories.length} историй фреймами, ${Object.keys(context.assets).length} SVG; kit.json ${Buffer.byteLength(json)} байт, kit.zip ${zip.length} байт\n`,
  )
  const unbound = bundle.report.unboundColors.sort((a, b) => b.count - a.count).slice(0, 10)
  for (const entry of unbound) {
    process.stderr.write(
      `  непривязан ×${entry.count}: ${JSON.stringify(entry.light)} / ${JSON.stringify(entry.dark)} - ${entry.where.join('; ')}\n`,
    )
  }
  return printReport(report)
}
