/*
 * Эмуляция плагина в браузере (`storyframe emulate`): дерево слоёв каждого варианта и истории из `kit.json`
 * рисуется HTML по правилам auto layout Figma (hug, fill, fixed, абсолютные дети, обводка внутрь) и снимается
 * так же, как эталоны `storyframe export --shots`. Сверка `storyframe compare --figma <workDir>/shots/emulated`
 * ловит ошибки конвертера и раскладки без Figma. Чего эмуляция не знает: метрик шрифтов Figma, её импорта SVG
 * и рендера текста - их проверяют только снимки из самой Figma.
 *
 *   storyframe emulate [--kit <выгрузка>/kit.json] [--out <workDir>/shots/emulated]
 *                      [--only <подстрока id набора или истории>]
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { evaluate, launchChrome, openTab, serveStatic } from '../lib/storybook-shots.mjs'
import { SVG_TINT } from './capture/types.ts'
import { loadProject } from './paths.mjs'

/** Цвет ссылки в CSS: токен - светлое значение из выгрузки, литерал - светлый. */
function cssColor(tokens, ref) {
  if (!ref) return 'transparent'
  const value = 'token' in ref ? tokens.get(ref.token)?.light : ref.light
  if (!value) return 'magenta'
  const alpha = value.a * ('token' in ref && ref.opacity !== undefined ? ref.opacity : 1)
  return `rgba(${Math.round(value.r * 255)}, ${Math.round(value.g * 255)}, ${Math.round(value.b * 255)}, ${alpha})`
}

function cssPaint(tokens, paint) {
  if (paint.kind === 'solid')
    return `linear-gradient(${cssColor(tokens, paint.color)}, ${cssColor(tokens, paint.color)})`
  return `linear-gradient(${paint.angle}deg, ${paint.stops.map((stop) => `${cssColor(tokens, stop.color)} ${stop.pos * 100}%`).join(', ')})`
}

const JUSTIFY = { min: 'flex-start', center: 'center', max: 'flex-end', 'space-between': 'space-between' }
const ALIGN = { min: 'flex-start', center: 'center', max: 'flex-end', baseline: 'baseline', stretch: 'flex-start' }
const ALIGN_SELF = { min: 'flex-start', center: 'center', max: 'flex-end' }

/**
 * HTML узла. `parent` - раскладка родителя и его поведение размера (как у `syncChildPlacement` плагина):
 * FILL у ребёнка родителя по содержимому и в переносимом ряду становится FIXED.
 */
function render(node, context, parent) {
  const { tokens, assets, components } = context
  const style = ['box-sizing: border-box', 'position: relative', 'flex: none']
  const inFlow = parent && parent.layout.mode !== 'none' && !node.absolute
  if (!parent || parent.layout.mode === 'none' || node.absolute) {
    if (parent) style.push('position: absolute', `left: ${node.box.x}px`, `top: ${node.box.y}px`)
  }
  if (node.opacity !== undefined) style.push(`opacity: ${node.opacity}`)
  // Размер по правилам плагина.
  const hugs =
    (node.type === 'frame' && node.layout.mode !== 'none') || (node.type === 'text' && node.autoResize === 'both')
  let width = 'fixed'
  let height = 'fixed'
  if (node.type === 'frame' && node.layout.mode !== 'none') {
    width = node.sizing?.w === 'fixed' ? 'fixed' : 'hug'
    height = node.sizing?.h === 'fixed' ? 'fixed' : 'hug'
  } else if (node.type === 'text') {
    width = node.autoResize === 'both' ? 'hug' : 'fixed'
    height = 'hug'
  }
  if (inFlow) {
    const horizontal = parent.layout.mode === 'row'
    const stretch = node.alignSelf ? node.alignSelf === 'stretch' : parent.layout.align === 'stretch'
    const axis = (hint, fallback) =>
      hint === 'fill' ? 'fill' : hint === 'fixed' ? 'fixed' : hint === 'hug' ? (hugs ? 'hug' : 'fixed') : fallback
    const sizing = node.type === 'frame' ? node.sizing : undefined
    let main = node.grow ? 'fill' : axis(horizontal ? sizing?.w : sizing?.h, hugs ? 'hug' : 'fixed')
    let cross = stretch ? 'fill' : axis(horizontal ? sizing?.h : sizing?.w, hugs ? 'hug' : 'fixed')
    if (node.type === 'text') {
      main = horizontal ? (node.autoResize === 'both' ? 'hug' : 'fixed') : 'hug'
      cross = stretch ? 'fill' : horizontal ? 'hug' : node.autoResize === 'both' ? 'hug' : 'fixed'
    }
    if (main === 'fill' && (parent.mainHug || parent.layout.wrap)) main = 'fixed'
    if (cross === 'fill' && parent.crossHug) cross = 'fixed'
    if (horizontal) {
      width = main
      height = cross
    } else {
      height = main
      width = cross
    }
    if ((horizontal ? width : height) === 'fill')
      style.push('flex: 1 1 0', horizontal ? 'min-width: 0' : 'min-height: 0')
    if ((horizontal ? height : width) === 'fill') style.push('align-self: stretch')
    else if (node.alignSelf && node.alignSelf !== 'stretch') style.push(`align-self: ${ALIGN_SELF[node.alignSelf]}`)
  }
  if (width === 'fixed') style.push(`width: ${node.box.w}px`)
  else if (width === 'hug') style.push('width: max-content')
  if (height === 'fixed') style.push(`height: ${node.box.h}px`)
  else if (height === 'hug') style.push('height: max-content')

  switch (node.type) {
    case 'text': {
      const s = node.style
      style.push(
        `font-family: '${s.family}'`,
        `font-weight: ${s.weight}`,
        `font-size: ${s.sizePx}px`,
        `line-height: ${s.lineHeightPx}px`,
        `letter-spacing: ${s.letterSpacingPx}px`,
        `color: ${cssColor(tokens, node.color)}`,
        `text-align: ${s.align}`,
        `white-space: ${node.autoResize === 'both' ? 'pre' : 'pre-wrap'}`,
        `text-transform: ${{ original: 'none', upper: 'uppercase', lower: 'lowercase', title: 'capitalize' }[s.textCase]}`,
        `text-decoration: ${{ none: 'none', underline: 'underline', strike: 'line-through' }[s.decoration]}`,
      )
      if (node.decorationColor) style.push(`text-decoration-color: ${cssColor(tokens, node.decorationColor)}`)
      if (node.decorationThickness) style.push(`text-decoration-thickness: ${node.decorationThickness}px`)
      if (node.decorationOffset) style.push(`text-underline-offset: ${node.decorationOffset}px`)
      if (node.truncate) style.push('overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap')
      const text = node.text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
      return `<div style="${style.join('; ')}">${text}</div>`
    }
    case 'svg': {
      const markup = (assets[node.asset] ?? '').replaceAll(SVG_TINT, cssColor(tokens, node.color))
      style.push('overflow: hidden', `width: ${node.box.w}px`, `height: ${node.box.h}px`)
      return `<div style="${style.join('; ')}">${markup.replace('<svg', '<svg style="display:block;width:100%;height:100%"')}</div>`
    }
    case 'instance': {
      const set = components.get(node.component)
      const variant = set?.variants.find((entry) =>
        Object.entries(node.variant).every(([axis, value]) => entry.variant[axis] === value),
      )
      if (!variant) return `<div style="${style.join('; ')}; outline: 1px dashed magenta"></div>`
      const label = Object.values(node.overrides.text)[0]
      const labelPath = set.textProps[0]?.path
      const tree = label !== undefined && labelPath ? withText(variant.tree, labelPath, label) : variant.tree
      // Экземпляр - корень варианта с размещением узла в родителе.
      return render(
        { ...tree, box: node.box, absolute: node.absolute, grow: node.grow, alignSelf: node.alignSelf },
        context,
        parent,
      )
    }
    default: {
      if (node.layout.mode !== 'none') {
        const l = node.layout
        style.push(
          'display: flex',
          `flex-direction: ${l.mode === 'row' ? 'row' : 'column'}`,
          `justify-content: ${JUSTIFY[l.justify]}`,
          `align-items: ${ALIGN[l.align]}`,
          `gap: ${l.justify === 'space-between' ? 0 : l.gap}px`,
          `padding: ${l.padding.map((value) => `${value}px`).join(' ')}`,
        )
        if (l.wrap)
          style.push('flex-wrap: wrap', `${l.mode === 'row' ? 'row' : 'column'}-gap: ${l.crossGap ?? l.gap}px`)
      }
      if (node.fills.length)
        style.push(
          `background: ${[...node.fills]
            .reverse()
            .map((paint) => cssPaint(tokens, paint))
            .join(', ')}`,
        )
      const [tl, tr, br, bl] = node.radius.values
      style.push(`border-radius: ${tl}px ${tr}px ${br}px ${bl}px`)
      const shadows = node.effects
        .filter((effect) => effect.type !== 'backgroundBlur')
        .map(
          (effect) =>
            `${effect.type === 'inner' ? 'inset ' : ''}${effect.offset.x}px ${effect.offset.y}px ${effect.blur}px ${effect.spread}px ${cssColor(tokens, effect.color)}`,
        )
      if (shadows.length) style.push(`box-shadow: ${shadows.join(', ')}`)
      const blur = node.effects.find((effect) => effect.type === 'backgroundBlur')
      if (blur) style.push(`backdrop-filter: blur(${blur.radius}px)`)
      if (node.clip) style.push('overflow: hidden')
      if (node.minWidth) style.push(`min-width: ${node.minWidth}px`)
      if (node.minHeight) style.push(`min-height: ${node.minHeight}px`)
      const own = {
        layout: node.layout,
        mainHug:
          node.layout.mode === 'row' ? width !== 'fixed' && width !== 'fill' : height !== 'fixed' && height !== 'fill',
        crossHug:
          node.layout.mode === 'row' ? height !== 'fixed' && height !== 'fill' : width !== 'fixed' && width !== 'fill',
      }
      const children = node.children.map((child) => render(child, context, own)).join('')
      let stroke = ''
      if (node.stroke) {
        const [t, r, b, l] = node.stroke.weights
        const color = cssColor(tokens, node.stroke.color)
        const image = node.stroke.paint ? `border-image: ${cssPaint(tokens, node.stroke.paint)} 1;` : ''
        stroke = `<div style="position:absolute; inset:0; box-sizing:border-box; pointer-events:none; border-style:${node.stroke.dash ? 'dashed' : 'solid'}; border-color:${color}; border-width:${t}px ${r}px ${b}px ${l}px; border-radius:${tl}px ${tr}px ${br}px ${bl}px; ${image}"></div>`
      }
      return `<div style="${style.join('; ')}">${children}${stroke}</div>`
    }
  }
}

function withText(tree, labelPath, text) {
  if (tree.type === 'text') return tree.path === labelPath ? { ...tree, text } : tree
  if (tree.type !== 'frame') return tree
  return { ...tree, children: tree.children.map((child) => withText(child, labelPath, text)) }
}

function variantKey(variant, axes) {
  return axes.map((axis) => `${axis.name}=${variant[axis.name]}`).join(', ')
}

export async function main(argv = process.argv.slice(2), root = process.cwd()) {
  const { paths } = await loadProject(root)
  const { values } = parseArgs({
    args: argv,
    options: {
      kit: { type: 'string', default: path.join(paths.out, 'kit.json') },
      out: { type: 'string', default: paths.shots.emulated },
      only: { type: 'string' },
    },
  })
  const bundle = JSON.parse(await readFile(path.resolve(root, values.kit), 'utf8'))
  const context = {
    tokens: new Map(bundle.tokens.colors.map((token) => [token.id, token])),
    assets: bundle.assets.svg,
    components: new Map(bundle.components.map((component) => [component.id, component])),
  }
  const jobs = []
  for (const component of bundle.components) {
    for (const variant of component.variants) {
      jobs.push({ folder: component.id, name: variantKey(variant.variant, component.axes), tree: variant.tree })
    }
  }
  for (const story of bundle.stories) jobs.push({ folder: 'stories', name: story.id, tree: story.tree })
  const selected = values.only
    ? jobs.filter((job) => `${job.folder}/${job.name}`.toLowerCase().includes(values.only.toLowerCase()))
    : jobs
  const out = path.resolve(root, values.out)
  if (!values.only) await rm(out, { recursive: true, force: true })
  const server = await serveStatic(paths.storybook)
  const origin = `http://127.0.0.1:${server.address().port}`
  const profile = await mkdtemp(path.join(tmpdir(), 'storyframe-emulate-'))
  const chrome = launchChrome(profile)
  try {
    const tab = await openTab(chrome.cdp, { width: 1600, height: 1000 }, { newWindow: true })
    // Шрифты - из каталога: страница эмуляции подключает его CSS шрифтов.
    await tab.send('Page.navigate', { url: `${origin}/iframe.html` })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    for (const [index, job] of selected.entries()) {
      const html = render(job.tree, context, null)
      const rect = await evaluate(
        tab,
        (win, markup) => {
          const doc = win.document
          doc.body.innerHTML = `<div id="storyframe-emulated" style="position:absolute;left:0;top:0;background:#fff">${markup}</div>`
          doc.body.style.margin = '0'
          return doc.fonts.ready.then(() => {
            const node = doc.getElementById('storyframe-emulated').firstElementChild
            const box = node.getBoundingClientRect()
            return { x: box.left, y: box.top, width: box.width, height: box.height }
          })
        },
        [html],
        `${job.folder}/${job.name}`,
      )
      if (!rect || rect.width === 0 || rect.height === 0) continue
      const { data } = await tab.send('Page.captureScreenshot', {
        format: 'png',
        clip: { ...rect, scale: 2 },
        captureBeyondViewport: true,
      })
      const dir = path.join(out, job.folder)
      await mkdir(dir, { recursive: true })
      await writeFile(path.join(dir, `${job.name.replaceAll('/', '-')}.png`), Buffer.from(data, 'base64'))
      if ((index + 1) % 200 === 0) process.stderr.write(`  ${index + 1} из ${selected.length}\n`)
    }
    process.stderr.write(`Эмуляция: ${selected.length} снимков в ${path.relative(root, out)}\n`)
  } finally {
    await chrome.close()
    await rm(profile, { recursive: true, force: true })
    server.close()
  }
  return 0
}
