/*
 * Capturing stories of the Storybook static build with headless Chrome over CDP: a static server, the
 * browser, a tab with frozen animations and waiting for the story to render. The shared part of
 * `scripts/datatable-shots.mjs` (DataTable screenshots for comparison with the reference) and
 * `scripts/mcp/shots.mjs` (story screenshots for the MCP set).
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import type { Readable, Writable } from 'node:stream'

export const TIMEOUT_MS = 30_000
export const QUIET_MS = 500

const MIME_TYPES: Partial<Record<string, string>> = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

/** A static server over the build directory on a free `127.0.0.1` port. */
export function serveStatic(dir: string): Promise<Server> {
  const server = createServer((request, response) => {
    // A request of an HTTP server always has `url`.
    const file = path.join(dir, decodeURIComponent(new URL(request.url as string, 'http://localhost').pathname))
    if (!file.startsWith(dir + path.sep)) {
      response.writeHead(404).end()
      return
    }
    readFile(file).then(
      (body) =>
        response
          .writeHead(200, { 'content-type': MIME_TYPES[path.extname(file)] ?? 'application/octet-stream' })
          .end(body),
      () => response.writeHead(404).end(),
    )
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

/** The browser process as `launchChrome` spawns it: stderr and the CDP pipes on fds 3 and 4 are open. */
type TChromeProcess = ChildProcess & { stderr: Readable }

/** A CDP message from the browser: a command reply (`id`) or an event (`method`, `params`). */
interface ICdpMessage {
  id?: number
  method?: string
  sessionId?: string
  params?: unknown
  result?: unknown
  error?: { message: string }
}

/** Results of the CDP commands whose replies are read; replies of other commands are not typed. */
interface ICdpResults {
  'Target.createTarget': { targetId: string }
  'Target.attachToTarget': { sessionId: string }
  'Page.navigate': { errorText?: string }
  'Page.captureScreenshot': { data: string }
  'Runtime.evaluate': {
    result: { value?: unknown }
    exceptionDetails?: { text: string; exception?: { description?: string } }
  }
  'DOM.getDocument': { root: { nodeId: number } }
  'DOM.querySelector': { nodeId: number }
}

export type TCdpResult<M extends string> = M extends keyof ICdpResults ? ICdpResults[M] : unknown

/** CDP over the browser pipe: commands (to a tab with `sessionId`) and waiting for an event. */
export interface ICdp {
  send<M extends string>(method: M, params?: object, sessionId?: string): Promise<TCdpResult<M>>
  once(method: string, sessionId: string | undefined): Promise<unknown>
}

/** A browser tab: its CDP session and commands to it. */
export interface ITab {
  sessionId: string
  send<M extends string>(method: M, params?: object): Promise<TCdpResult<M>>
}

/** The tab's `window` as the functions run by `evaluate` see it. */
export type TPageWindow = Window & typeof globalThis

interface IPendingCommand {
  method: string
  resolve(result: unknown): void
  reject(error: Error): void
}

function connect(chrome: TChromeProcess): ICdp {
  // Events have no `id`: their lookup misses.
  const pending = new Map<number | undefined, IPendingCommand>()
  const listeners = new Set<(message: ICdpMessage) => void>()
  let lastId = 0
  let buffer = ''
  let stderr = ''

  const rejectAll = (reason: string) => {
    for (const request of pending.values()) request.reject(new Error(`Chrome: ${reason}\n${stderr}`))
    pending.clear()
  }
  chrome.on('error', (error) => rejectAll(`${error.message}; the browser path is set by the CHROME variable`))
  chrome.on('exit', (code, signal) => rejectAll(`process exited, code ${code ?? signal}`))
  chrome.stderr.setEncoding('utf8')
  chrome.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-4000)
  })

  const [input, output] = [chrome.stdio[3], chrome.stdio[4]] as [Writable, Readable]
  output.setEncoding('utf8')
  output.on('data', (chunk: string) => {
    buffer += chunk
    for (let end = buffer.indexOf('\0'); end !== -1; end = buffer.indexOf('\0')) {
      const message = JSON.parse(buffer.slice(0, end)) as ICdpMessage
      buffer = buffer.slice(end + 1)
      const request = pending.get(message.id)
      if (!request) {
        for (const listener of listeners) listener(message)
      } else {
        pending.delete(message.id)
        if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`))
        else request.resolve(message.result)
      }
    }
  })

  return {
    send<M extends string>(
      method: M,
      params: object = {},
      sessionId: string | undefined = undefined,
    ): Promise<TCdpResult<M>> {
      lastId += 1
      const id = lastId
      return new Promise((resolve, reject) => {
        pending.set(id, { method, resolve, reject })
        input.write(`${JSON.stringify({ id, method, params, sessionId })}\0`)
      })
    },
    once(method: string, sessionId: string | undefined): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(listener)
          reject(new Error(`${method}: no event within ${TIMEOUT_MS / 1000} s`))
        }, TIMEOUT_MS)
        const listener = (message: ICdpMessage) => {
          if (message.method !== method || message.sessionId !== sessionId) return
          clearTimeout(timer)
          listeners.delete(listener)
          resolve(message.params)
        }
        listeners.add(listener)
      })
    },
  }
}

/**
 * Headless Chrome driven over CDP through a pipe. `close` shuts it down with a CDP command and waits for exit:
 * after SIGTERM Chrome keeps writing to the profile directory, and removing the directory fails with ENOTEMPTY.
 */
export function launchChrome(profileDir: string, { hover = false }: { hover?: boolean } = {}) {
  const chrome = spawn(
    process.env.CHROME ?? 'google-chrome',
    [
      '--headless',
      // Headless Chrome reports a device without hover, and MUI disables `:hover` under `@media (hover: none)`;
      // the export for Figma needs hover states, the MCP set screenshots do not.
      ...(hover
        ? ['--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4']
        : []),
      '--remote-debugging-pipe',
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-extensions',
      '--disable-sync',
      '--force-color-profile=srgb',
      // With partial raster (the default) screenshots of open windows differ from capture to capture:
      // pixels at button edges differ by 1–2 color levels.
      '--disable-partial-raster',
      '--mute-audio',
      // The TeamCity build runs in a container as root: Chrome does not start its sandbox as root, and the
      // container's /dev/shm (64 MB) is too small for four capture tabs.
      ...(process.getuid?.() === 0 ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    ],
    // Own process group: the browser does not receive SIGINT from Ctrl+C in the terminal, and `close` shuts it
    // down with a CDP command.
    { detached: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] },
  ) as TChromeProcess
  const cdp = connect(chrome)
  return {
    cdp,
    async close() {
      if (chrome.pid !== undefined && chrome.exitCode === null && chrome.signalCode === null) {
        const exited = once(chrome, 'exit')
        await cdp.send('Browser.close').catch(() => chrome.kill())
        await exited
      }
    },
  }
}

function freezeAnimations(win: Window) {
  win.document.addEventListener('DOMContentLoaded', () => {
    const style = win.document.createElement('style')
    style.textContent = `*, *::before, *::after {
      animation-delay: 0s !important;
      animation-duration: 0s !important;
      animation-iteration-count: 1 !important;
      transition-delay: 0s !important;
      transition-duration: 0s !important;
      caret-color: transparent !important;
    }`
    win.document.head.append(style)
  })
}

/**
 * A tab of the given size with frozen animations. Several tabs of one browser capture only with
 * `newWindow`: a hidden tab receives no frames, and `requestAnimationFrame` in it never fires.
 */
export async function openTab(
  cdp: ICdp,
  viewport: { width: number; height: number },
  { newWindow = false }: { newWindow?: boolean } = {},
): Promise<ITab> {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const send = <M extends string>(method: M, params?: object) => cdp.send(method, params, sessionId)
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${String(freezeAnimations)})(window)` })
  return { sessionId, send }
}

async function settle(
  win: TPageWindow & { __STORYBOOK_PREVIEW__?: { currentRender?: { phase?: string } } },
  timeoutMs: number,
  quietMs: number,
) {
  const deadline = Date.now() + timeoutMs
  const waitFor = async (isReady: () => boolean, what: string) => {
    while (!isReady()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  // The `finished` phase comes both after a render error and after `play` completes.
  await waitFor(() => win.__STORYBOOK_PREVIEW__?.currentRender?.phase === 'finished', 'story render')
  if (win.document.body.classList.contains('sb-show-errordisplay')) {
    throw new Error(win.document.getElementById('error-message')?.textContent || 'story render error')
  }

  // The grid and windows re-layout after measuring the container and after fonts load, that is, already after
  // the `finished` phase.
  let lastMutation = 0
  const observer = new win.MutationObserver(() => {
    lastMutation = Date.now()
  })
  observer.observe(win.document.body, { attributes: true, characterData: true, childList: true, subtree: true })
  const waitQuiet = (what: string) => {
    lastMutation = Date.now()
    return waitFor(() => Date.now() - lastMutation >= quietMs, what)
  }
  await waitQuiet('a pause in DOM changes')
  // A font face loads when text using it first goes through layout, and headless Chrome lays out lazily:
  // `fonts.ready` resolved before the face was requested, and the text was captured with fallback font metrics
  // (bold labels, monospaced digits), depending on which stories the tab had opened before. So all font faces
  // declared on the page are loaded right away.
  await Promise.allSettled([...win.document.fonts].map((face) => face.load()))
  await win.document.fonts.ready
  await waitQuiet('a pause in DOM changes after fonts load')
  observer.disconnect()
  await Promise.race([
    new Promise((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve))),
    new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('timed out waiting for: animation frames')), Math.max(0, deadline - Date.now()))
    }),
  ])
}

/** Runs the function `(win, ...args)` in the tab; an exception in the tab becomes an error labeled `label`. */
export async function evaluate<TWin extends Window, TArgs extends unknown[], TResult>(
  tab: ITab,
  fn: (win: TWin, ...args: TArgs) => TResult,
  args: TArgs,
  label: string,
): Promise<Awaited<TResult>> {
  const { result, exceptionDetails } = await tab.send('Runtime.evaluate', {
    expression: `(${String(fn)})(window${args.map((arg) => `, ${JSON.stringify(arg)}`).join('')})`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (exceptionDetails) {
    throw new Error(`${label}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`)
  }
  return result.value as Awaited<TResult>
}

/**
 * Opens a story of the static build and waits until it renders and settles: the `finished` phase
 * (after `play`), a pause in the DOM, fonts, two frames.
 */
export async function openStory(cdp: ICdp, tab: ITab, origin: string, storyId: string, mode: string, label: string) {
  const loaded = cdp.once('Page.loadEventFired', tab.sessionId)
  const { errorText } = await tab.send('Page.navigate', {
    url: `${origin}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story&globals=mode:${mode}`,
  })
  if (errorText) throw new Error(`${label}: ${errorText}`)
  await loaded
  await evaluate(tab, settle, [TIMEOUT_MS, QUIET_MS], label)
}
