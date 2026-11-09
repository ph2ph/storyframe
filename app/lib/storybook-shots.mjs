/*
 * Съёмка историй статической сборки Storybook headless-Chrome'ом по CDP: статический сервер,
 * браузер, вкладка с замороженными анимациями и ожидание отрисовки истории. Общая часть
 * `scripts/datatable-shots.mjs` (снимки DataTable для сверки с эталоном) и `scripts/mcp/shots.mjs`
 * (снимки историй для набора MCP).
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

/** Статический сервер над каталогом сборки на свободном порту `127.0.0.1`. */
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
 * Headless Chrome с управлением по CDP через pipe. `close` закрывает его командой CDP и ждёт выхода:
 * после SIGTERM Chrome ещё пишет в каталог профиля, и удаление каталога падает с ENOTEMPTY.
 */
export function launchChrome(profileDir, { hover = false } = {}) {
  const chrome = spawn(
    process.env.CHROME ?? 'google-chrome',
    [
      '--headless',
      // Headless Chrome считает устройство без hover, и MUI гасит `:hover` под `@media (hover: none)`;
      // выгрузке для Figma нужны состояния наведения, снимкам набора MCP - нет.
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
      // С частичной растеризацией (по умолчанию) снимки открытых окон различаются от съёмки к съёмке:
      // пиксели у краёв кнопок отличаются на 1–2 уровня цвета.
      '--disable-partial-raster',
      '--mute-audio',
      // Сборка в TeamCity идёт в контейнере от root: песочницу Chrome от root не запускает, а /dev/shm
      // контейнера (64 МБ) мал для четырёх вкладок съёмки.
      ...(process.getuid?.() === 0 ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
    ],
    // Своя группа процессов: SIGINT от Ctrl+C в терминале браузер не получает, и `close` закрывает его
    // командой CDP.
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
 * Вкладка заданного размера с замороженными анимациями. Несколько вкладок одного браузера снимают
 * только с `newWindow`: невидимая вкладка не получает кадров, и `requestAnimationFrame` в ней не
 * срабатывает.
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

  // Фаза `finished` наступает и после ошибки рендера, и после завершения `play`.
  await waitFor(() => win.__STORYBOOK_PREVIEW__?.currentRender?.phase === 'finished', 'рендер истории')
  if (win.document.body.classList.contains('sb-show-errordisplay')) {
    throw new Error(win.document.getElementById('error-message')?.textContent || 'ошибка рендера истории')
  }

  // Грид и окна перестраиваются после замера контейнера и после загрузки шрифтов, то есть уже после
  // фазы `finished`.
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
  // Начертание грузится, когда текст с ним впервые проходит раскладку, а headless Chrome раскладывает лениво:
  // `fonts.ready` выполнялся до запроса начертания, и текст снимался с метриками запасного шрифта (полужирные
  // подписи, моноширинные цифры) - в зависимости от того, какие истории вкладка открывала раньше. Поэтому
  // сразу грузятся все начертания, объявленные на странице.
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

/** Выполняет функцию `(win, ...args)` во вкладке; исключение во вкладке — ошибка с подписью `label`. */
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
 * Открывает историю статической сборки и ждёт, пока она отрисуется и затихнет: фаза `finished`
 * (после `play`), пауза в DOM, шрифты, два кадра.
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
