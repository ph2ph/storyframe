/*
 * Локальная раздача сборки Storybook с заголовком CORS (`storyframe serve`): проверка загрузки выгрузки в
 * плагин по ссылке. Интерфейс плагина Figma имеет origin `null`, поэтому серверу нужен
 * `Access-Control-Allow-Origin: *`; `http://localhost` браузер не считает mixed content.
 *
 *   storyframe serve [--port 6009] [--dir <сборка Storybook>]
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { loadProject } from './paths.mjs'

const MIME_TYPES = {
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.html': 'text/html',
  '.js': 'text/javascript',
}

export async function main(argv = process.argv.slice(2), root = process.cwd()) {
  const { paths } = await loadProject(root)
  const { values } = parseArgs({
    args: argv,
    options: { port: { type: 'string', default: '6009' }, dir: { type: 'string', default: paths.storybook } },
  })
  const dir = path.resolve(root, values.dir)
  const server = createServer((request, response) => {
    const file = path.join(dir, decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname))
    if (!file.startsWith(dir + path.sep)) {
      response.writeHead(404).end()
      return
    }
    readFile(file).then(
      (body) =>
        response
          .writeHead(200, {
            'content-type': MIME_TYPES[path.extname(file)] ?? 'application/octet-stream',
            'access-control-allow-origin': '*',
            'cache-control': 'no-store',
          })
          .end(body),
      () => response.writeHead(404, { 'access-control-allow-origin': '*' }).end(),
    )
  })
  await new Promise((resolve) => server.listen(parseInt(values.port, 10), '127.0.0.1', resolve))
  const { port } = server.address()
  const kit = path.relative(dir, path.join(paths.out, 'kit.json')).split(path.sep).join('/')
  process.stderr.write(
    `Выгрузка для Figma: http://localhost:${port}/${kit} (в плагине - адрес http://localhost:${port})\n`,
  )
  // Сервер работает до Ctrl+C.
  return new Promise(() => {})
}
