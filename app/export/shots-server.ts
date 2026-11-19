/*
 * Receiver of screenshots from the Figma plugin (`storyframe shots-server`): the "Send screenshots" button in
 * the plugin first sends `POST /begin` (the folder is cleared), then POSTs the PNG of every variant and story
 * frame to `http://localhost:6010/shot/<folder>/<name>.png`; the files land in `<workDir>/shots/figma/` for
 * `storyframe compare`. Local only: no authorization, no HTTPS.
 *
 *   storyframe shots-server [--port 6010] [--dir <workDir>/shots/figma]
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { loadProject } from './paths.ts'

export async function main(argv = process.argv.slice(2), root = process.cwd()): Promise<number> {
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
    // The plugin starts a send: screenshots of the previous run (other variant names) only hinder the comparison.
    if (request.method === 'POST' && request.url === '/begin') {
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir, { recursive: true })
      process.stderr.write('New upload: shots folder cleared\n')
      response.end('ok')
      return
    }
    const match = /^\/shot\/(.+)$/.exec(request.url ?? '')
    if (request.method !== 'POST' || !match) {
      response.statusCode = 404
      response.end('POST /shot/<folder>/<name>.png')
      return
    }
    const segments = decodeURIComponent(match[1])
      .split('/')
      .map((segment) => segment.replace(/[\\:*?"<>|]+/g, '-').trim())
      .filter((segment) => segment && segment !== '..')
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks)
      const bytes = request.headers['content-type']?.startsWith('text/plain')
        ? Buffer.from(body.toString('utf8'), 'base64')
        : body
      const target = path.join(dir, ...segments)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, bytes)
      process.stderr.write(`${segments.join('/')} ${bytes.length} B\n`)
      response.end('ok')
    })
  })
  await new Promise<void>((resolve) => server.listen(Number(values.port), resolve))
  process.stderr.write(`Shots receiver: http://localhost:${values.port}/shot/… → ${path.relative(root, dir)}\n`)
  // The server runs until Ctrl+C.
  return new Promise(() => {})
}
