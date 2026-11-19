/*
 * Component capture for the export: the Storybook static build of the catalog in headless Chrome, the DOM →
 * layers converter injected into the tab, the "Basic" story's args iterated through the Storybook channel
 * without reloads, modes switched by the `mode` global, states by `CSS.forcePseudoState` over CDP, by focus
 * and by args.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { evaluate, launchChrome, openStory, openTab, serveStatic, type ITab } from '../lib/storybook-shots.ts'
import type { ICaptureResult } from './capture/walk.ts'
import { findRootSelector } from './discover.ts'

export type TMode = 'light' | 'dark'

/** A story control as Storybook normalizes it: `{ type }`, or `{ disable: true }` for `control: false`. */
export interface IStoryControl {
  type?: string
  disable?: boolean
}

/** An arg of the story as the export reads it from `argTypes`. */
export interface IStoryArgType {
  options: unknown[] | null
  /** The control type; a control without one (disabled) stays an object. */
  control: string | IStoryControl | null
  description: string
}

export interface IStoryArgTypes {
  description: string
  initialArgs: Record<string, unknown>
  argTypes: Record<string, IStoryArgType>
}

/** A sample to capture: story args and a state (forced pseudo-classes, focus); `root` overrides the job's root. */
export interface ICaptureSample {
  key: string
  args: Record<string, unknown>
  root?: string | null
  state?: { pseudo?: string[]; focus?: boolean }
}

/** One capture job of `shoot`: a story, its root selector and the samples. */
export interface IShootJob {
  storyId: string
  root: string
  /** Name of the root layer. */
  name: string
  samples: ICaptureSample[]
  slotIndex?: number
  /** Folder of the reference screenshots under `shots`, by default `name`. */
  shotsFolder?: string
}

/** Converter results of a sample in each mode. */
export type TSampleCapture = Partial<Record<TMode, ICaptureResult>>

export interface ICaptureSessionOptions {
  /** Storybook static build. */
  staticDir: string
  tabs?: number
  log?: (message: string) => void
  /** Folder of the reference screenshots; without it there are none. */
  shots?: string | null
}

/** The parts of a story from the preview store that the export reads. */
interface IPreviewStory {
  parameters?: { docs?: { description?: { component?: string } } }
  initialArgs?: Record<string, unknown>
  argTypes?: Record<string, { options?: unknown[]; control?: IStoryControl; description?: unknown }>
}

/** The parts of the Storybook preview (`window.__STORYBOOK_PREVIEW__`) that the capture relies on. */
interface IStorybookPreview {
  channel: {
    emit(event: string, payload: object): void
    once(event: string, listener: (...args: unknown[]) => void): void
  }
  storyStore: {
    loadStory(options: { storyId: string }): Promise<IPreviewStory>
    args?: { get?(storyId: string): Record<string, unknown> | undefined }
  }
  currentRender?: { phase?: string }
}

/** The tab's `window` with the Storybook preview. */
type TPreviewWindow = Window & { __STORYBOOK_PREVIEW__: IStorybookPreview }

/** A capture tab and the story and mode open in it. */
interface ISlot {
  tab: ITab
  storyId: string | null
  mode: string | null
}

const VIEWPORT = { width: 1280, height: 900 }
const MODES: TMode[] = ['light', 'dark']
// Re-render deadline after an args change: usually it fits in tenths of a second, but under the load of four
// tabs it occasionally takes longer than five seconds, and the screenshot would take the colors of the previous
// state.
const RENDER_TIMEOUT_MS = 15000
/** Args that MUI keeps in internal state (`useControlled`): changing them requires a remount. */
const STATEFUL_ARGS = new Set([
  'checked',
  'defaultChecked',
  'indeterminate',
  'value',
  'defaultValue',
  'expanded',
  'open',
  'selected',
])

/** The converter as a single file for injection into the page. */
export async function bundleConverter(): Promise<string> {
  const result = await build({
    entryPoints: [path.join(import.meta.dirname, `capture/index${path.extname(import.meta.filename)}`)],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2020',
    logLevel: 'silent',
  })
  return result.outputFiles[0].text
}

/** Args and value lists from the story's `argTypes`, without navigation, from the preview store. */
function readStoryArgTypes(win: TPreviewWindow, storyId: string): Promise<IStoryArgTypes> {
  return win.__STORYBOOK_PREVIEW__.storyStore.loadStory({ storyId }).then((story) => ({
    // The component description is a standard Storybook parameter (`docs.description.component`, the docs
    // page shows the same one).
    description: story.parameters?.docs?.description?.component ?? '',
    initialArgs: Object.fromEntries(
      Object.entries(story.initialArgs ?? {}).filter(
        ([, value]) => typeof value !== 'function' && typeof value !== 'object',
      ),
    ),
    argTypes: Object.fromEntries(
      Object.entries(story.argTypes ?? {}).map(([name, argType]) => [
        name,
        {
          options: argType.options ?? null,
          control: argType.control?.type ?? argType.control ?? null,
          // The prop description from docgen: the Figma plugin labels the component set's axis with it.
          description: typeof argType.description === 'string' ? argType.description : '',
        },
      ]),
    ),
  }))
}

/**
 * Re-renders the story with new args and remounts it: without the remount, the MUI controls' state
 * (`useControlled`, ripple, focus) would survive the args change. Waits for the render event and two frames.
 */
function updateArgs(
  win: TPreviewWindow,
  storyId: string,
  args: Record<string, unknown>,
  timeoutMs: number,
  remount: boolean,
) {
  const channel = win.__STORYBOOK_PREVIEW__.channel
  const once = (event: string) => new Promise((resolve) => channel.once(event, resolve))
  const settle = (promise: Promise<unknown>) =>
    Promise.race([promise, once('storyErrored'), new Promise((resolve) => setTimeout(resolve, timeoutMs))])
  const rendered = once('storyRendered')
  channel.emit('resetStoryArgs', { storyId })
  channel.emit('updateStoryArgs', { storyId, updatedArgs: args })
  // The reset and the new args produce two renders, and the event of the first one (with the reset args) may
  // arrive before the second: the screenshot would take the intermediate state. Wait until the store holds the
  // wanted args and the current render is finished.
  const preview = win.__STORYBOOK_PREVIEW__
  const settled = () =>
    new Promise<void>((resolve) => {
      const deadline = Date.now() + timeoutMs
      const done = () => {
        const current = preview.storyStore?.args?.get?.(storyId) ?? null
        const same =
          !current ||
          Object.entries(args).every(([name, value]) => JSON.stringify(current[name]) === JSON.stringify(value))
        return same && ['finished', 'errored'].includes(preview.currentRender?.phase ?? 'finished')
      }
      const tick = () => (done() || Date.now() > deadline ? resolve() : setTimeout(tick, 25))
      tick()
    })
  return settle(rendered)
    .then(settled)
    .then(() => {
      if (!remount) return undefined
      const remounted = once('storyRendered')
      channel.emit('forceRemount', { storyId })
      return settle(remounted).then(settled)
    })
    .then(() => new Promise((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve))))
    .then(() => win.document.fonts.ready)
    .then(() =>
      win.document.body.classList.contains('sb-show-errordisplay')
        ? Promise.reject(new Error(win.document.getElementById('error-message')?.textContent || 'render error'))
        : undefined,
    )
}

function updateMode(win: TPreviewWindow, mode: string, timeoutMs: number) {
  const channel = win.__STORYBOOK_PREVIEW__.channel
  const rendered = new Promise((resolve) => channel.once('storyRendered', resolve))
  channel.emit('updateGlobals', { globals: { mode } })
  return Promise.race([rendered, new Promise((resolve) => setTimeout(resolve, timeoutMs))]).then(
    () => new Promise((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve))),
  )
}

function focusWithin(win: Window, selector: string) {
  const root = win.__storyframeCapture.find(selector)
  const target = root?.matches('input, textarea, button, [tabindex]')
    ? root
    : root?.querySelector('input, textarea, button, [tabindex]')
  if (target) (target as HTMLElement).focus()
  return new Promise((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)))
}

function blurAll(win: Window) {
  ;(win.document.activeElement as HTMLElement | null)?.blur?.()
  return new Promise((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)))
}

function captureIn(win: Window, selector: string, name: string) {
  return win.__storyframeCapture.capture(selector, name)
}

/**
 * Capture session: the browser, the static server and the tabs. `shoot(job)` captures one sample in all
 * states and modes. Close with `close()`.
 */
/**
 * Screenshot of the story root as a PNG at scale 2 on a white background: the reference for comparison with
 * the export from Figma (`compare.mjs`). The page background is suppressed for the duration of the screenshot
 * so that both sides are compared on white.
 */
async function shootReference(tab: ITab, selector: string): Promise<Buffer | null> {
  const rect = await evaluate(
    tab,
    (win, target) => {
      const element = win.__storyframeCapture.find(target)
      if (!element) return null
      const doc = win.document
      const style = doc.createElement('style')
      style.id = 'storyframe-shot-background'
      style.textContent = [
        'html, body, #storybook-root { background: #fff !important; background-image: none !important }',
        '[data-storyframe-hide] { visibility: hidden !important }',
        '[data-storyframe-show] { visibility: visible !important }',
      ].join('\n')
      doc.head.append(style)
      // Only the root is in the reference: ancestors of a different size (the decorator wrapper with the glow,
      // the padding around an input adornment) and siblings are hidden, the Figma layers do not have them.
      // Ancestors with the same box stay: the root inherits their appearance (`inheritAppearance`).
      const box = element.getBoundingClientRect()
      const near = (a: number, b: number) => Math.abs(a - b) <= 1
      const sameBox = (other: Element) => {
        const outer = other.getBoundingClientRect()
        const cs = win.getComputedStyle(other)
        const border = (['Top', 'Right', 'Bottom', 'Left'] as const).map(
          (side) => parseFloat(cs[`border${side}Width`]) || 0,
        )
        const fits = (x: number, y: number, w: number, h: number) =>
          near(x, box.x) && near(y, box.y) && near(w, box.width) && near(h, box.height)
        return (
          fits(outer.x, outer.y, outer.width, outer.height) ||
          fits(
            outer.x + border[3],
            outer.y + border[0],
            outer.width - border[1] - border[3],
            outer.height - border[0] - border[2],
          )
        )
      }
      let keep = true
      for (let node = element; node.parentElement && node !== doc.body; node = node.parentElement) {
        const parent = node.parentElement
        for (const sibling of parent.children) if (sibling !== node) sibling.setAttribute('data-storyframe-hide', '')
        keep = keep && sameBox(parent)
        if (parent !== doc.body) parent.setAttribute(keep ? 'data-storyframe-show' : 'data-storyframe-hide', '')
      }
      element.setAttribute('data-storyframe-show', '')
      return { x: box.left + win.scrollX, y: box.top + win.scrollY, width: box.width, height: box.height }
    },
    [selector],
    'shot rect',
  )
  if (!rect || rect.width === 0 || rect.height === 0) return null
  try {
    const { data } = await tab.send('Page.captureScreenshot', {
      format: 'png',
      clip: { ...rect, scale: 2 },
      captureBeyondViewport: true,
    })
    return Buffer.from(data, 'base64')
  } finally {
    await evaluate(
      tab,
      (win) => {
        win.document.getElementById('storyframe-shot-background')?.remove()
        for (const node of win.document.querySelectorAll('[data-storyframe-hide], [data-storyframe-show]')) {
          node.removeAttribute('data-storyframe-hide')
          node.removeAttribute('data-storyframe-show')
        }
      },
      [],
      'shot cleanup',
    )
  }
}

/**
 * No transitions or animations, no scrollbars: styles are read in their final state, and the story width does
 * not jump by the scrollbar width (the page with and without it gave variants 1185 and 1200 px wide). Figma
 * has no scrollbars either.
 */
const FREEZE_MOTION = `document.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style')
  style.textContent = '*, *::before, *::after, *::placeholder { transition: none !important; animation: none !important; } * { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }'
  document.head.append(style)
})`

export async function createCaptureSession({
  staticDir,
  tabs = 4,
  log = () => {},
  shots = null,
}: ICaptureSessionOptions) {
  const converter = await bundleConverter()
  const server = await serveStatic(staticDir)
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const profile = await mkdtemp(path.join(tmpdir(), 'storyframe-figma-'))
  const chrome = launchChrome(profile, { hover: true })
  const pool: ISlot[] = []
  for (let i = 0; i < tabs; i += 1) {
    const tab = await openTab(chrome.cdp, VIEWPORT, { newWindow: true })
    await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: converter })
    await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: FREEZE_MOTION })
    await tab.send('DOM.enable')
    await tab.send('CSS.enable')
    pool.push({ tab, storyId: null, mode: null })
  }

  /**
   * Pseudo-class on the sample root over CDP. Returns the nodeId: the state must be released with the same
   * one, a new `DOM.getDocument` hands out new ids, and the reset by them did not reach the element (hover
   * stayed on the following samples, disabled was captured with hover colors).
   */
  async function forcePseudo(tab: ITab, selector: string, classes: string[]) {
    const { root } = await tab.send('DOM.getDocument', { depth: 0 })
    const { nodeId } = await tab.send('DOM.querySelector', { nodeId: root.nodeId, selector })
    if (!nodeId) throw new Error(`No element ${selector} for the state`)
    await tab.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: classes })
    await nextFrames(tab)
    return nodeId
  }

  async function releasePseudo(tab: ITab, nodeId: number) {
    await tab.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }).catch(() => {})
    await nextFrames(tab)
  }

  function nextFrames(tab: ITab) {
    return evaluate(
      tab,
      (win) => new Promise((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve))),
      [],
      'pseudo',
    )
  }

  /** A tab with the story open in the wanted mode; one story per tab to avoid reloads. */
  async function prepare(slot: ISlot, storyId: string, mode: string) {
    if (slot.storyId !== storyId) {
      slot.storyId = null
      try {
        await openStory(chrome.cdp, slot.tab, origin, storyId, mode, storyId)
      } catch (error) {
        // Under the load of neighboring tabs the story render occasionally misses the deadline, and a module of
        // the build fails to load ("Failed to fetch dynamically imported module"): one retry with a reload.
        if (!/timed out waiting for|dynamically imported module/.test(String(error))) throw error
        log(`  ${storyId}: ${(error as Error).message}, retrying`)
        await openStory(chrome.cdp, slot.tab, origin, storyId, mode, storyId)
      }
      slot.storyId = storyId
      slot.mode = mode
    } else if (slot.mode !== mode) {
      await evaluate(slot.tab, updateMode, [mode, RENDER_TIMEOUT_MS], `${storyId}: mode ${mode}`)
      slot.mode = mode
    }
  }

  return {
    origin,
    async argTypes(storyId: string, slotIndex = 0): Promise<IStoryArgTypes> {
      const slot = pool[slotIndex % pool.length]
      await prepare(slot, storyId, 'light')
      return evaluate(slot.tab, readStoryArgTypes, [storyId], `${storyId}: argTypes`)
    },
    /** Forget the tab's story: the next capture opens it anew (after a render error the story is broken). */
    reset(slotIndex = 0) {
      pool[slotIndex % pool.length].storyId = null
    },
    /** Story root selector by the `<Prefix><Name>-root` class, otherwise `fallback` (`discover.mjs`). */
    async resolveRoot(storyId: string, id: string, fallback: string | null, slotIndex = 0): Promise<string | null> {
      const slot = pool[slotIndex % pool.length]
      await prepare(slot, storyId, 'light')
      return evaluate(slot.tab, findRootSelector, [id, fallback], `${storyId}: root`)
    },
    /**
     * Captures a sample: `samples` is a list of `{ key, args, state: { pseudo?: string[], focus?: boolean } }`.
     * Returns `{ key: { light, dark } }` with the converter results.
     */
    async shoot({
      storyId,
      root: defaultRoot,
      name,
      samples,
      slotIndex = 0,
      shotsFolder = name,
    }: IShootJob): Promise<Record<string, TSampleCapture>> {
      const slot = pool[slotIndex % pool.length]
      const results: Record<string, TSampleCapture> = {}
      for (const mode of MODES) {
        await prepare(slot, storyId, mode)
        let previousStateful = null
        for (const sample of samples) {
          const label = `${storyId} ${sample.key} (${mode})`
          const root = sample.root ?? defaultRoot
          // Remount only when the internal state args change: it is expensive.
          const stateful = JSON.stringify(Object.entries(sample.args).filter(([arg]) => STATEFUL_ARGS.has(arg)))
          const remount = stateful !== '[]' && stateful !== previousStateful
          previousStateful = stateful
          const state = sample.state ?? {}
          const attempt = async (withRemount: boolean) => {
            await evaluate(slot.tab, updateArgs, [storyId, sample.args, RENDER_TIMEOUT_MS, withRemount], label)
            const forced = state.pseudo?.length ? await forcePseudo(slot.tab, root, state.pseudo) : null
            if (state.focus) await evaluate(slot.tab, focusWithin, [root], label)
            try {
              results[sample.key] ??= {}
              results[sample.key][mode] = await evaluate(slot.tab, captureIn, [root, name], label)
              if (shots && mode === 'light') {
                const png = await shootReference(slot.tab, root)
                if (png) {
                  const dir = path.join(shots, shotsFolder)
                  await mkdir(dir, { recursive: true })
                  await writeFile(path.join(dir, `${sample.key.replaceAll('/', '-')}.png`), png)
                }
              }
            } finally {
              if (forced) await releasePseudo(slot.tab, forced)
              if (state.focus) await evaluate(slot.tab, blurAll, [], label)
            }
          }
          try {
            await attempt(remount)
          } catch (error) {
            // Under the load of neighboring tabs the remounted story occasionally fails to render within the
            // deadline: one retry with a remount and a pause.
            if (!/No element|is invisible or empty/.test(String(error))) throw error
            log(`  ${label}: ${String((error as Partial<Error>).message ?? error).slice(0, 120)}, retrying`)
            await new Promise((resolve) => setTimeout(resolve, 500))
            await attempt(true)
          }
          log(label)
        }
      }
      return results
    },
    async close() {
      await chrome.close()
      await rm(profile, { recursive: true, force: true })
      server.close()
    },
  }
}
