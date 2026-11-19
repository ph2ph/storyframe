/*
 * Local serving of the Storybook static build with a CORS header (`storyframe serve`): checks that the export
 * loads into the Figma plugin by URL. The Figma plugin UI has origin `null`, so the server needs
 * `Access-Control-Allow-Origin: *`; the browser does not treat `http://localhost` as mixed content.
 *
 *   storyframe serve [--port 6009] [--dir <Storybook static build>]
 */

import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { loadProject } from './paths.ts'

const MIME_TYPES: Partial<Record<string, string>> = {
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.html': 'text/html',
  '.js': 'text/javascript',
}

export async function main(argv = process.argv.slice(2), root = process.cwd()): Promise<number> {
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
  await new Promise<void>((resolve) => server.listen(parseInt(values.port, 10), '127.0.0.1', resolve))
  // Listening on a TCP port: the address is an `AddressInfo`.
  const { port } = server.address() as AddressInfo
  const kit = path.relative(dir, path.join(paths.out, 'kit.json')).split(path.sep).join('/')
  process.stderr.write(
    `Export for Figma: http://localhost:${port}/${kit} (in the plugin use the address http://localhost:${port})\n`,
  )
  // The server runs until Ctrl+C.
  return new Promise(() => {})
}
