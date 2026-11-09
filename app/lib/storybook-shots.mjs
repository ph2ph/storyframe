/*
 * Capturing stories of the Storybook static build with headless Chrome over CDP: a static server, the
 * browser, a tab with frozen animations and waiting for the story to render. The shared part of
 * `scripts/datatable-shots.mjs` (DataTable screenshots for comparison with the reference) and
 * `scripts/mcp/shots.mjs` (story screenshots for the MCP set).
 */

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

export const TIMEOUT_MS = 30_000
export const QUIET_MS = 500

const MIME_TYPES = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

/** A static server over the build directory on a free `127.0.0.1` port. */
export function serveStatic(dir) {
  const server = createServer((request, response) => {
    const file = path.join(dir, decodeURIComponent(new URL(request.url, 'http://localhost').pathname))
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

function connect(chrome) {
  const pending = new Map()
  const listeners = new Set()
  let lastId = 0
  let buffer = ''
  let stderr = ''

  const rejectAll = (reason) => {
    for (const request of pending.values()) request.reject(new Error(`Chrome: ${reason}\n${stderr}`))
    pending.clear()
  }
  chrome.on('error', (error) => rejectAll(`${error.message}; путь к браузеру задаёт переменная CHROME`))
  chrome.on('exit', (code, signal) => rejectAll(`процесс завершился, код ${code ?? signal}`))
  chrome.stderr.setEncoding('utf8')
  chrome.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-4000)
  })

  const [input, output] = [chrome.stdio[3], chrome.stdio[4]]
  output.setEncoding('utf8')
  output.on('data', (chunk) => {
    buffer += chunk
    for (let end = buffer.indexOf('\0'); end !== -1; end = buffer.indexOf('\0')) {
      const message = JSON.parse(buffer.slice(0, end))
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
    send(method, params = {}, sessionId = undefined) {
      lastId += 1
      const id = lastId
      return new Promise((resolve, reject) => {
        pending.set(id, { method, resolve, reject })
        input.write(`${JSON.stringify({ id, method, params, sessionId })}\0`)
      })
    },
    once(method, sessionId) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(listener)
          reject(new Error(`${method}: нет события за ${TIMEOUT_MS / 1000} с`))
        }, TIMEOUT_MS)
        const listener = (message) => {
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
export function launchChrome(profileDir, { hover = false } = {}) {
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
  )
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

function freezeAnimations(win) {
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
export async function openTab(cdp, viewport, { newWindow = false } = {}) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow })
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
  const send = (method, params) => cdp.send(method, params, sessionId)
  await send('Page.enable')
  await send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false })
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${freezeAnimations})(window)` })
  return { sessionId, send }
}

async function settle(win, timeoutMs, quietMs) {
  const deadline = Date.now() + timeoutMs
  const waitFor = async (isReady, what) => {
    while (!isReady()) {
      if (Date.now() > deadline) throw new Error(`не дождались: ${what}`)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }

  // The `finished` phase comes both after a render error and after `play` completes.
  await waitFor(() => win.__STORYBOOK_PREVIEW__?.currentRender?.phase === 'finished', 'рендер истории')
  if (win.document.body.classList.contains('sb-show-errordisplay')) {
    throw new Error(win.document.getElementById('error-message')?.textContent || 'ошибка рендера истории')
  }

  // The grid and windows re-layout after measuring the container and after fonts load, that is, already after
  // the `finished` phase.
  let lastMutation = 0
  const observer = new win.MutationObserver(() => {
    lastMutation = Date.now()
  })
  observer.observe(win.document.body, { attributes: true, characterData: true, childList: true, subtree: true })
  const waitQuiet = (what) => {
    lastMutation = Date.now()
    return waitFor(() => Date.now() - lastMutation >= quietMs, what)
  }
  await waitQuiet('паузы в изменениях DOM')
  // A font face loads when text using it first goes through layout, and headless Chrome lays out lazily:
  // `fonts.ready` resolved before the face was requested, and the text was captured with fallback font metrics
  // (bold labels, monospaced digits), depending on which stories the tab had opened before. So all font faces
  // declared on the page are loaded right away.
  await Promise.allSettled([...win.document.fonts].map((face) => face.load()))
  await win.document.fonts.ready
  await waitQuiet('паузы в изменениях DOM после загрузки шрифтов')
  observer.disconnect()
  await Promise.race([
    new Promise((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve))),
    new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('не дождались: кадров отрисовки')), Math.max(0, deadline - Date.now()))
    }),
  ])
}

/** Runs the function `(win, ...args)` in the tab; an exception in the tab becomes an error labeled `label`. */
export async function evaluate(tab, fn, args, label) {
  const { result, exceptionDetails } = await tab.send('Runtime.evaluate', {
    expression: `(${fn})(window${args.map((arg) => `, ${JSON.stringify(arg)}`).join('')})`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (exceptionDetails) {
    throw new Error(`${label}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`)
  }
  return result.value
}

/**
 * Opens a story of the static build and waits until it renders and settles: the `finished` phase
 * (after `play`), a pause in the DOM, fonts, two frames.
 */
export async function openStory(cdp, tab, origin, storyId, mode, label) {
  const loaded = cdp.once('Page.loadEventFired', tab.sessionId)
  const { errorText } = await tab.send('Page.navigate', {
    url: `${origin}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story&globals=mode:${mode}`,
  })
  if (errorText) throw new Error(`${label}: ${errorText}`)
  await loaded
  await evaluate(tab, settle, [TIMEOUT_MS, QUIET_MS], label)
}
