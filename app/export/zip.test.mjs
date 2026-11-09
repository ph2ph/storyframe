import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { createZip } from './zip.mjs'

/** Reads the archive via the central directory, the same way the plugin UI does. */
function readZip(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  let eocd = buffer.length - 22
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1
  const count = view.getUint16(eocd + 10, true)
  let position = view.getUint32(eocd + 16, true)
  const files = new Map()
  for (let i = 0; i < count; i += 1) {
    const method = view.getUint16(position + 10, true)
    const size = view.getUint32(position + 20, true)
    const nameLength = view.getUint16(position + 28, true)
    const localOffset = view.getUint32(position + 42, true)
    const name = Buffer.from(buffer.subarray(position + 46, position + 46 + nameLength)).toString('utf8')
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const data = buffer.subarray(start, start + size)
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data))
    position += 46 + nameLength
  }
  return files
}

describe('ZIP writer', () => {
  it('the archive reads back: compressed text and a short file stored uncompressed', () => {
    const json = JSON.stringify({ kit: 'storyframe'.repeat(80) })
    const zip = createZip([
      { name: 'kit.json', data: json, date: new Date(Date.UTC(2026, 9, 31, 12, 30, 0)) },
      { name: 'x', data: new Uint8Array([1, 2, 3]) },
    ])
    const files = readZip(zip)
    expect([...files.keys()]).toEqual(['kit.json', 'x'])
    expect(files.get('kit.json').toString('utf8')).toBe(json)
    expect([...files.get('x')]).toEqual([1, 2, 3])
    expect(zip.length).toBeLessThan(json.length)
  })

  it('is read by DecompressionStream, as in the plugin UI', async () => {
    const zip = createZip([{ name: 'kit.json', data: 'ab'.repeat(500) }])
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
    const size = view.getUint32(18, true)
    const nameLength = view.getUint16(26, true)
    const data = zip.subarray(30 + nameLength, 30 + nameLength + size)
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
    const text = await new Response(stream).text()
    expect(text).toBe('ab'.repeat(500))
  })
})
