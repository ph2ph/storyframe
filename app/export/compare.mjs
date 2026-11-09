/*
 * Сверка снимков: эталоны историй из браузера (`storyframe export --shots`) против экспорта вариантов из
 * Figma (приёмник `storyframe shots-server` + кнопка «Отправить снимки» в плагине) или эмуляции плагина
 * (`storyframe emulate`). Обе стороны - PNG в масштабе 2; сравнение идёт на белом фоне по пересечению,
 * разница в размере считается отдельно. Папки по умолчанию - в `<workDir>/shots/`.
 *
 *   storyframe compare [--storybook dir] [--figma dir] [--out dir] [--top 20] [--threshold 24]
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { loadProject } from './paths.mjs'
import { decodePng, encodePng } from './png.mjs'

async function listPngs(root, prefix = '') {
  const result = []
  for (const entry of await readdir(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name)
    if (entry.isDirectory()) result.push(...(await listPngs(root, relative)))
    else if (entry.name.endsWith('.png')) result.push(relative)
  }
  return result
}

/** Пиксель поверх белого: у экспорта Figma фон прозрачный, у браузерного снимка - белый. */
function overWhite(data, index) {
  const alpha = data[index + 3] / 255
  return [
    Math.round(data[index] * alpha + 255 * (1 - alpha)),
    Math.round(data[index + 1] * alpha + 255 * (1 - alpha)),
    Math.round(data[index + 2] * alpha + 255 * (1 - alpha)),
  ]
}

/**
 * @returns {{ mismatch: number, sizeDelta: [number, number], diff: { width: number, height: number, data: Uint8Array } }}
 * `mismatch` - доля пикселей пересечения, отличающихся сильнее порога по любому каналу.
 */
export function compareImages(reference, candidate, threshold = 24) {
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

/** Три картинки рядом: эталон, Figma, разница; все - поверх белого, высота по большей. */
export function triptych(reference, candidate, diff) {
  const gap = 8
  const height = Math.max(reference.height, candidate.height, diff.height)
  const width = reference.width + candidate.width + diff.width + gap * 2
  const data = new Uint8Array(width * height * 4).fill(255)
  const blit = (image, left) => {
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
 * Предел сверки на картинку: эталон, снимок, разница и триптих каталога иконок высотой 174 тысячи пикселей в
 * масштабе 2 занимали гигабайты памяти и роняли машину без swap. Такие пары пропускаются с пометкой.
 */
export const MAX_PIXELS = 16_000_000

/** Ширина и высота PNG из заголовка IHDR, без распаковки. */
export function pngSize(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

export async function main(argv = process.argv.slice(2), root = process.cwd()) {
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
  // Триптихи прошлой сверки с исправленными с тех пор вариантами путали бы картину.
  await rm(values.out, { recursive: true, force: true })
  const references = await listPngs(values.storybook)
  const rows = []
  const oversized = []
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
