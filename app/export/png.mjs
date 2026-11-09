/*
 * Minimal PNG: reading 8-bit non-interlaced files (gray, gray+alpha, RGB, RGBA) and writing RGBA. Needed only
 * by the screenshot comparison (`compare.mjs`), hence no dependencies and no exotic parts of the format.
 */

import { deflateSync, inflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 }

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})

function crc32(bytes) {
  let crc = -1
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/** @returns {{ width: number, height: number, data: Uint8Array }} RGBA, 4 bytes per pixel */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('Не PNG')
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 6
  const idat = []
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    const body = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      if (body[8] !== 8) throw new Error(`PNG: глубина ${body[8]} бит не поддерживается`)
      if (body[12] !== 0) throw new Error('PNG: interlace не поддерживается')
      colorType = body[9]
      if (!(colorType in CHANNELS)) throw new Error(`PNG: тип цвета ${colorType} не поддерживается`)
    } else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  const channels = CHANNELS[colorType]
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(idat))
  const data = new Uint8Array(width * height * 4)
  let previous = new Uint8Array(stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const line = Uint8Array.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? line[i - channels] : 0
      const up = previous[i]
      const upLeft = i >= channels ? previous[i - channels] : 0
      if (filter === 1) line[i] = (line[i] + left) & 0xff
      else if (filter === 2) line[i] = (line[i] + up) & 0xff
      else if (filter === 3) line[i] = (line[i] + ((left + up) >> 1)) & 0xff
      else if (filter === 4) line[i] = (line[i] + paeth(left, up, upLeft)) & 0xff
    }
    for (let x = 0; x < width; x += 1) {
      const from = x * channels
      const to = (y * width + x) * 4
      if (channels >= 3) {
        data[to] = line[from]
        data[to + 1] = line[from + 1]
        data[to + 2] = line[from + 2]
        data[to + 3] = channels === 4 ? line[from + 3] : 255
      } else {
        data[to] = data[to + 1] = data[to + 2] = line[from]
        data[to + 3] = channels === 2 ? line[from + 1] : 255
      }
    }
    previous = line
  }
  return { width, height, data }
}

function chunk(type, body) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(body.length)
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), body])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([length, typed, crc])
}

/** RGBA → PNG without filters: the comparison values simplicity over file size. */
export function encodePng({ width, height, data }) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0
    raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1)
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
