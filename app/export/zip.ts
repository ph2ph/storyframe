/*
 * ZIP without dependencies: `kit.zip` next to `kit.json`; the `@ph2ph/storyframe/zip` entry point hands the
 * writer to the Figma plugin for the build archive. Only what the writer needs: local headers, the central
 * directory and EOCD, deflate compression (`node:zlib`). The plugin window (`ui/zip.ts`) reads such an archive
 * through `DecompressionStream('deflate-raw')`.
 */

import { crc32, deflateRawSync } from 'node:zlib'

const LOCAL_HEADER = 0x04034b50
const CENTRAL_HEADER = 0x02014b50
const EOCD = 0x06054b50
const VERSION = 20
const FLAG_UTF8 = 0x0800
const METHOD_DEFLATE = 8
const METHOD_STORE = 0

/** MS-DOS date and time: seconds are halved, the year counts from 1980. */
function dosDateTime(input: Date): { time: number; day: number } {
  // The format cannot go before 1980: such dates (for example `new Date(0)`) are written as the first day of 1980.
  const date = input.getUTCFullYear() < 1980 ? new Date(Date.UTC(1980, 0, 1)) : input
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1)
  const day = ((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate()
  return { time, day }
}

export interface IZipEntry {
  name: string
  data: Uint8Array | string
  date?: Date
}

/** Assembles a ZIP from a list of files. */
export function createZip(files: IZipEntry[]): Uint8Array<ArrayBuffer> {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const raw = typeof file.data === 'string' ? Buffer.from(file.data, 'utf8') : Buffer.from(file.data)
    const deflated = deflateRawSync(raw, { level: 9 })
    const useDeflate = deflated.length < raw.length
    const data = useDeflate ? deflated : raw
    const method = useDeflate ? METHOD_DEFLATE : METHOD_STORE
    const checksum = crc32(raw)
    const { time, day } = dosDateTime(file.date ?? new Date(0))

    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_HEADER, 0)
    local.writeUInt16LE(VERSION, 4)
    local.writeUInt16LE(FLAG_UTF8, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(day, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(CENTRAL_HEADER, 0)
    central.writeUInt16LE(VERSION, 4)
    central.writeUInt16LE(VERSION, 6)
    central.writeUInt16LE(FLAG_UTF8, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(day, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)

    localParts.push(local, name, data)
    centralParts.push(central, name)
    offset += local.length + name.length + data.length
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(EOCD, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, ...centralParts, end])
}
