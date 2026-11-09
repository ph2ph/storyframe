/*
 * Съёмка компонентов для выгрузки: статическая сборка каталога в headless Chrome, конвертер DOM → слои
 * внедрён в вкладку, аргументы «Базовой» истории перебираются через канал Storybook без перезагрузки,
 * режимы переключаются глобалом `mode`, состояния - `CSS.forcePseudoState` по CDP, фокусом и аргументами.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build } from 'esbuild'
import { evaluate, launchChrome, openStory, openTab, serveStatic } from '../lib/storybook-shots.mjs'
import { findRootSelector } from './discover.mjs'

const VIEWPORT = { width: 1280, height: 900 }
const MODES = ['light', 'dark']
// Срок перерисовки после смены аргументов: обычно она укладывается в десятые доли секунды, но под нагрузкой
// четырёх вкладок изредка дольше пяти секунд - и снимок брал бы цвета прежнего состояния.
const RENDER_TIMEOUT_MS = 15000
/** Аргументы, которые MUI держит во внутреннем состоянии (`useControlled`): смена требует перемонтирования. */
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

/** Конвертер одним файлом для внедрения в страницу. */
export async function bundleConverter() {
  const result = await build({
    entryPoints: [path.join(import.meta.dirname, 'capture/index.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2020',
    logLevel: 'silent',
  })
  return result.outputFiles[0].text
}

/** Аргументы и список значений из `argTypes` истории - без навигации, из стора превью. */
function readStoryArgTypes(win, storyId) {
  return win.__STORYBOOK_PREVIEW__.storyStore.loadStory({ storyId }).then((story) => ({
    // Описание компонента - стандартный параметр Storybook (`docs.description.component`, его же показывает
    // страница документации).
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
          // Описание пропа из docgen: плагин подписывает им ось набора.
          description: typeof argType.description === 'string' ? argType.description : '',
        },
      ]),
    ),
  }))
}

/**
 * Перерисовка истории с новыми аргументами и перемонтирование: без него состояние контролов MUI
 * (`useControlled`, ripple, фокус) пережило бы смену аргументов. Ждёт событие рендера и два кадра.
 */
function updateArgs(win, storyId, args, timeoutMs, remount) {
  const channel = win.__STORYBOOK_PREVIEW__.channel
  const once = (event) => new Promise((resolve) => channel.once(event, resolve))
  const settle = (promise) =>
    Promise.race([promise, once('storyErrored'), new Promise((resolve) => setTimeout(resolve, timeoutMs))])
  const rendered = once('storyRendered')
  channel.emit('resetStoryArgs', { storyId })
  channel.emit('updateStoryArgs', { storyId, updatedArgs: args })
  // Сброс и новые аргументы дают два рендера, и событие первого (со сброшенными аргументами) может прийти
  // раньше второго: снимок взял бы промежуточное состояние. Ждём, пока в сторе нужные аргументы, а текущий
  // рендер завершён.
  const preview = win.__STORYBOOK_PREVIEW__
  const settled = () =>
    new Promise((resolve) => {
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
        ? Promise.reject(new Error(win.document.getElementById('error-message')?.textContent || 'ошибка рендера'))
        : undefined,
    )
}

function updateMode(win, mode, timeoutMs) {
  const channel = win.__STORYBOOK_PREVIEW__.channel
  const rendered = new Promise((resolve) => channel.once('storyRendered', resolve))
  channel.emit('updateGlobals', { globals: { mode } })
  return Promise.race([rendered, new Promise((resolve) => setTimeout(resolve, timeoutMs))]).then(
    () => new Promise((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve))),
  )
}

function focusWithin(win, selector) {
  const root = win.__storyframeCapture.find(selector)
  const target = root?.matches('input, textarea, button, [tabindex]')
    ? root
    : root?.querySelector('input, textarea, button, [tabindex]')
  if (target) target.focus()
  return new Promise((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)))
}

function blurAll(win) {
  win.document.activeElement?.blur?.()
  return new Promise((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)))
}

function captureIn(win, selector, name) {
  return win.__storyframeCapture.capture(selector, name)
}

/**
 * Сессия съёмки: браузер, статический сервер и вкладки. `shoot(job)` снимает один образец во всех
 * состояниях и режимах. Закрывать `close()`.
 */
/**
 * Снимок корня истории как PNG в масштабе 2 на белом фоне: эталон для сверки с экспортом из Figma
 * (`compare.mjs`). Фон страницы на время снимка гасится, чтобы обе стороны сравнивались на белом.
 */
async function shootReference(tab, selector) {
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
      // В эталоне только корень: предки другого размера (обёртка декоратора со свечением, поле вокруг
      // украшения ввода) и соседи прячутся - в слоях Figma их нет. Предки того же бокса остаются: их облик
      // корень наследует (`inheritAppearance`).
      const box = element.getBoundingClientRect()
      const near = (a, b) => Math.abs(a - b) <= 1
      const sameBox = (other) => {
        const outer = other.getBoundingClientRect()
        const cs = win.getComputedStyle(other)
        const border = ['Top', 'Right', 'Bottom', 'Left'].map((side) => parseFloat(cs[`border${side}Width`]) || 0)
        const fits = (x, y, w, h) => near(x, box.x) && near(y, box.y) && near(w, box.width) && near(h, box.height)
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
 * Без переходов и анимаций, без полос прокрутки: стили читаются в конечном состоянии, а ширина историй не
 * скачет на ширину полосы (страница с ней и без неё давала варианты шириной 1185 и 1200 px). Полос нет и в
 * Figma.
 */
const FREEZE_MOTION = `document.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style')
  style.textContent = '*, *::before, *::after, *::placeholder { transition: none !important; animation: none !important; } * { scrollbar-width: none !important; } ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }'
  document.head.append(style)
})`

export async function createCaptureSession({ staticDir, tabs = 4, log = () => {}, shots = null }) {
  const converter = await bundleConverter()
  const server = await serveStatic(staticDir)
  const origin = `http://127.0.0.1:${server.address().port}`
  const profile = await mkdtemp(path.join(tmpdir(), 'storyframe-figma-'))
  const chrome = launchChrome(profile, { hover: true })
  const pool = []
  for (let i = 0; i < tabs; i += 1) {
    const tab = await openTab(chrome.cdp, VIEWPORT, { newWindow: true })
    await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: converter })
    await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: FREEZE_MOTION })
    await tab.send('DOM.enable')
    await tab.send('CSS.enable')
    pool.push({ tab, storyId: null, mode: null })
  }

  /**
   * Псевдокласс на корне образца по CDP. Возвращает nodeId: снимать состояние нужно с ним же - новый
   * `DOM.getDocument` выдаёт новые id, и сброс по ним до элемента не доходил (hover оставался на следующих
   * образцах, disabled снимался с цветами наведения).
   */
  async function forcePseudo(tab, selector, classes) {
    const { root } = await tab.send('DOM.getDocument', { depth: 0 })
    const { nodeId } = await tab.send('DOM.querySelector', { nodeId: root.nodeId, selector })
    if (!nodeId) throw new Error(`Нет элемента ${selector} для состояния`)
    await tab.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: classes })
    await nextFrames(tab)
    return nodeId
  }

  async function releasePseudo(tab, nodeId) {
    await tab.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }).catch(() => {})
    await nextFrames(tab)
  }

  function nextFrames(tab) {
    return evaluate(
      tab,
      (win) => new Promise((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve))),
      [],
      'pseudo',
    )
  }

  /** Вкладка с открытой историей в нужном режиме; одна история на вкладку, чтобы не перезагружать. */
  async function prepare(slot, storyId, mode) {
    if (slot.storyId !== storyId) {
      slot.storyId = null
      try {
        await openStory(chrome.cdp, slot.tab, origin, storyId, mode, storyId)
      } catch (error) {
        // Под нагрузкой соседних вкладок рендер истории изредка не укладывается в срок, а модуль сборки
        // не догружается («Failed to fetch dynamically imported module»): один повтор с перезагрузкой.
        if (!/не дождались|dynamically imported module/.test(String(error))) throw error
        log(`  ${storyId}: ${error.message}, повтор`)
        await openStory(chrome.cdp, slot.tab, origin, storyId, mode, storyId)
      }
      slot.storyId = storyId
      slot.mode = mode
    } else if (slot.mode !== mode) {
      await evaluate(slot.tab, updateMode, [mode, RENDER_TIMEOUT_MS], `${storyId}: режим ${mode}`)
      slot.mode = mode
    }
  }

  return {
    origin,
    /** @returns {Promise<{ description: string, initialArgs: object, argTypes: object }>} */
    async argTypes(storyId, slotIndex = 0) {
      const slot = pool[slotIndex % pool.length]
      await prepare(slot, storyId, 'light')
      return evaluate(slot.tab, readStoryArgTypes, [storyId], `${storyId}: argTypes`)
    },
    /** Забыть историю вкладки: следующая съёмка откроет её заново (после ошибки рендера история сломана). */
    reset(slotIndex = 0) {
      pool[slotIndex % pool.length].storyId = null
    },
    /** Селектор корня истории по классу `<Префикс><Имя>-root`, иначе `fallback` (`discover.mjs`). */
    async resolveRoot(storyId, id, fallback, slotIndex = 0) {
      const slot = pool[slotIndex % pool.length]
      await prepare(slot, storyId, 'light')
      return evaluate(slot.tab, findRootSelector, [id, fallback], `${storyId}: корень`)
    },
    /**
     * Снимает образец: `samples` - список `{ key, args, state: { pseudo?: string[], focus?: boolean } }`.
     * Возвращает `{ key: { light, dark } }` с результатами конвертера.
     */
    async shoot({ storyId, root: defaultRoot, name, samples, slotIndex = 0, shotsFolder = name }) {
      const slot = pool[slotIndex % pool.length]
      const results = {}
      for (const mode of MODES) {
        await prepare(slot, storyId, mode)
        let previousStateful = null
        for (const sample of samples) {
          const label = `${storyId} ${sample.key} (${mode})`
          const root = sample.root ?? defaultRoot
          // Перемонтирование - только когда меняются аргументы внутреннего состояния: оно дорогое.
          const stateful = JSON.stringify(Object.entries(sample.args).filter(([arg]) => STATEFUL_ARGS.has(arg)))
          const remount = stateful !== '[]' && stateful !== previousStateful
          previousStateful = stateful
          const state = sample.state ?? {}
          const attempt = async (withRemount) => {
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
            // Под нагрузкой соседних вкладок перемонтированная история изредка не успевает отрисоваться за срок:
            // один повтор с перемонтированием и паузой.
            if (!/Нет элемента|невидим или пуст/.test(String(error))) throw error
            log(`  ${label}: ${String(error.message ?? error).slice(0, 120)}, повтор`)
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
