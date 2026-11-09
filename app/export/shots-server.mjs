/*
 * Приёмник снимков из плагина Figma (`storyframe shots-server`): кнопка «Отправить снимки» в плагине сначала
 * шлёт `POST /begin` (папка очищается), затем PNG каждого варианта и фрейма истории POST'ом на
 * `http://localhost:6010/shot/<папка>/<имя>.png`; файлы ложатся в `<workDir>/shots/figma/` для
 * `storyframe compare`. Только локально: ни авторизации, ни HTTPS.
 *
 *   storyframe shots-server [--port 6010] [--dir <workDir>/shots/figma]
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { loadProject } from './paths.mjs'

export async function main(argv = process.argv.slice(2), root = process.cwd()) {
  const { paths } = await loadProject(root)
  const { values } = parseArgs({
    args: argv,
    options: { port: { type: 'string', default: '6010' }, dir: { type: 'string', default: paths.shots.figma } },
  })
  const dir = path.resolve(root, values.dir)
  mkdirSync(dir, { recursive: true })

  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Headers', '*')
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    if (request.method === 'OPTIONS') {
      response.end()
      return
    }
    // Начало отправки из плагина: снимки прошлого запуска (другие имена вариантов) сверке только мешают.
    if (request.method === 'POST' && request.url === '/begin') {
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
      process.stderr.write('Новая отправка: папка снимков очищена\n')
      response.end('ok')
      return
    }
    const match = /^\/shot\/(.+)$/.exec(request.url ?? '')
    if (request.method !== 'POST' || !match) {
      response.statusCode = 404
      response.end('POST /shot/<папка>/<имя>.png')
      return
    }
    const segments = decodeURIComponent(match[1])
      .split('/')
      .map((segment) => segment.replace(/[\\:*?"<>|]+/g, '-').trim())
      .filter((segment) => segment && segment !== '..')
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks)
      const bytes = request.headers['content-type']?.startsWith('text/plain')
        ? Buffer.from(body.toString('utf8'), 'base64')
        : body
      const target = path.join(dir, ...segments)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, bytes)
      process.stderr.write(`${segments.join('/')} ${bytes.length} Б\n`)
      response.end('ok')
    })
  })
  await new Promise((resolve) => server.listen(Number(values.port), resolve))
  process.stderr.write(`Приёмник снимков: http://localhost:${values.port}/shot/… → ${path.relative(root, dir)}\n`)
  // Сервер работает до Ctrl+C.
  return new Promise(() => {})
}
