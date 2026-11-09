/*
 * Screenshot comparison: story references from the browser (`storyframe export --shots`) against the variants
 * exported from Figma (the `storyframe shots-server` receiver plus the "Send screenshots" button in the plugin)
 * or the plugin emulation (`storyframe emulate`). Both sides are PNG at scale 2; the comparison runs on a white
 * background over the intersection, the size difference is counted separately. Default folders are in
 * `<workDir>/shots/`.
 *
 *   storyframe compare [--storybook dir] [--figma dir] [--out dir] [--top 20] [--threshold 24]
 */

/* oxlint-disable no-console -- the comparison summary is the command's output on stdout */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { loadProject } from './paths.ts'
import { decodePng, encodePng, type IRgbaImage } from './png.ts'

async function listPngs(root: string, prefix = ''): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name)
    if (entry.isDirectory()) result.push(...(await listPngs(root, relative)))
    else if (entry.name.endsWith('.png')) result.push(relative)
  }
  return result
}

/** A pixel over white: the Figma export has a transparent background, the browser screenshot a white one. */
function overWhite(data: Uint8Array, index: number) {
  const alpha = data[index + 3] / 255
  return [
    Math.round(data[index] * alpha + 255 * (1 - alpha)),
    Math.round(data[index + 1] * alpha + 255 * (1 - alpha)),
    Math.round(data[index + 2] * alpha + 255 * (1 - alpha)),
  ]
}

export interface IImageComparison {
  mismatch: number
  sizeDelta: [number, number]
  diff: IRgbaImage
}

/**
 * `mismatch` is the share of intersection pixels that differ by more than the threshold in any channel.
 */
export function compareImages(reference: IRgbaImage, candidate: IRgbaImage, threshold = 24): IImageComparison {
  const width = Math.max(reference.width, candidate.width)
  const height = Math.max(reference.height, candidate.height)
  const common = {
    width: Math.min(reference.width, candidate.width),
    height: Math.min(reference.height, candidate.height),
  }
  const diff = new Uint8Array(width * height * 4)
  let differing = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const to = (y * width + x) * 4
      const inside = x < common.width && y < common.height
      if (!inside) {
        diff.set([255, 230, 0, 255], to)
        continue
      }
      const a = overWhite(reference.data, (y * reference.width + x) * 4)
      const b = overWhite(candidate.data, (y * candidate.width + x) * 4)
      const delta = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))
      if (delta > threshold) {
        differing += 1
        diff.set([220, 30, 30, 255], to)
      } else {
        const grey = Math.round(255 - (255 - a[0]) * 0.25)
        diff.set([grey, grey, grey, 255], to)
      }
    }
  }
  const area = common.width * common.height || 1
  return {
    mismatch: differing / area,
    sizeDelta: [candidate.width - reference.width, candidate.height - reference.height],
    diff: { width, height, data: diff },
  }
}

/** Three images side by side: reference, Figma, difference; all over white, height by the tallest. */
export function triptych(reference: IRgbaImage, candidate: IRgbaImage, diff: IRgbaImage): IRgbaImage {
  const gap = 8
  const height = Math.max(reference.height, candidate.height, diff.height)
  const width = reference.width + candidate.width + diff.width + gap * 2
  const data = new Uint8Array(width * height * 4).fill(255)
  const blit = (image: IRgbaImage, left: number) => {
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const [r, g, b] = overWhite(image.data, (y * image.width + x) * 4)
        data.set([r, g, b, 255], (y * width + left + x) * 4)
      }
    }
  }
  blit(reference, 0)
  blit(candidate, reference.width + gap)
  blit(diff, reference.width + candidate.width + gap * 2)
  return { width, height, data }
}

/**
 * Comparison limit per image: the reference, screenshot, difference and triptych of the icon catalog, 174
 * thousand pixels tall at scale 2, took gigabytes of memory and crashed a machine without swap. Such pairs are
 * skipped with a note.
 */
export const MAX_PIXELS = 16_000_000

/** PNG width and height from the IHDR header, without decoding. */
export function pngSize(buffer: Buffer): { width: number; height: number } {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

export async function main(argv = process.argv.slice(2), root = process.cwd()): Promise<number> {
  const { paths } = await loadProject(root)
  const { values: raw } = parseArgs({
    args: argv,
    options: {
      storybook: { type: 'string', default: paths.shots.storybook },
      figma: { type: 'string', default: paths.shots.figma },
      out: { type: 'string', default: paths.shots.diff },
      top: { type: 'string', default: '20' },
      threshold: { type: 'string', default: '24' },
    },
  })
  const values = {
    ...raw,
    storybook: path.resolve(root, raw.storybook),
    figma: path.resolve(root, raw.figma),
    out: path.resolve(root, raw.out),
  }
  const threshold = Number(values.threshold)
  // Triptychs of the previous comparison with variants fixed since then would muddle the picture.
  await rm(values.out, { recursive: true, force: true })
  const references = await listPngs(values.storybook)
  const rows: { relative: string; mismatch: number; sizeDelta: [number, number] }[] = []
  const oversized: string[] = []
  let missing = 0
  for (const relative of references) {
    const figmaFile = path.join(values.figma, relative)
    const candidateBuffer = await readFile(figmaFile).catch(() => null)
    if (!candidateBuffer) {
      missing += 1
      continue
    }
    const referenceBuffer = await readFile(path.join(values.storybook, relative))
    const sizes = [pngSize(referenceBuffer), pngSize(candidateBuffer)]
    if (sizes.some((size) => size.width * size.height > MAX_PIXELS)) {
      oversized.push(relative)
      continue
    }
    const reference = decodePng(referenceBuffer)
    const candidate = decodePng(candidateBuffer)
    const { mismatch, sizeDelta, diff } = compareImages(reference, candidate, threshold)
    rows.push({ relative, mismatch, sizeDelta })
    if (mismatch > 0.01 || Math.abs(sizeDelta[0]) > 2 || Math.abs(sizeDelta[1]) > 2) {
      const target = path.join(values.out, relative)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, encodePng(triptych(reference, candidate, diff)))
    }
  }
  rows.sort((a, b) => b.mismatch - a.mismatch)
  const top = Number(values.top)
  console.log(
    `Сверено: ${rows.length}, нет снимка Figma: ${missing}, расхождение > 1 %: ${rows.filter((row) => row.mismatch > 0.01).length}`,
  )
  if (oversized.length > 0) {
    console.log(`Не сверено (больше ${MAX_PIXELS / 1_000_000} Мпикс): ${oversized.join(', ')}`)
  }
  for (const row of rows.slice(0, top)) {
    const size =
      row.sizeDelta[0] || row.sizeDelta[1]
        ? ` размер ${row.sizeDelta[0] >= 0 ? '+' : ''}${row.sizeDelta[0]}×${row.sizeDelta[1] >= 0 ? '+' : ''}${row.sizeDelta[1]}`
        : ''
    console.log(`${(row.mismatch * 100).toFixed(1).padStart(5)} %  ${row.relative}${size}`)
  }
  console.log(`Картинки «эталон | Figma | разница»: ${path.relative(root, values.out)}`)
  return 0
}
