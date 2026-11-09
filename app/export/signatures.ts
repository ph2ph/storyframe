/*
 * Instances by class signatures (design, decision 6): a variant of a component set remembers the semantic
 * classes of its root; an element of another tree with the same classes becomes an instance of that variant.
 * A match means the signature is contained in the element's classes; the longest one wins, and on a tie the
 * variant without a state.
 */

import type {
  IBox,
  IFrameNode,
  IInstanceNode,
  ISvgNode,
  ITextNode,
  ITextStyleValues,
  TLayerNode,
} from './capture/types.ts'
import type { IDedupeVariant } from './dedupe.ts'

/** Text property of a component set: the layer path whose text an instance overrides. */
export interface ITextProp {
  name: string
  path: string
}

/** A component set as the index needs it: variants with the twins merged into them (`dedupe.ts`). */
export interface ISignatureComponent {
  id: string
  textProps?: ITextProp[]
  variants: IDedupeVariant[]
}

export interface ISignatureEntry {
  component: string
  variant: Record<string, string>
  signature: Set<string>
  tree: TLayerNode
  textProps: ITextProp[]
}

/** Signature index: root class of a component → variants with signatures. */
export type TSignatureIndex = Map<string, ISignatureEntry[]>

function stateRank(variant: Record<string, string>): number {
  const state = variant.State
  return state === undefined || state === 'default' ? 0 : 1
}

/** Signature index: root class of a component → variants with signatures. */
export function buildSignatureIndex(components: ISignatureComponent[]): TSignatureIndex {
  const index: TSignatureIndex = new Map()
  for (const component of components) {
    for (const variant of component.variants) {
      // Twins merged into a variant (`dedupe.mjs`) are found by their own signatures; the instance is that variant's.
      for (const source of [variant, ...(variant.aliases ?? [])]) {
        // The variant is indexed by every class of its root (not of the children, those carry the `>` prefix):
        // any shared class selects candidates, and the longest contained signature wins. No library prefixes needed.
        const entry: ISignatureEntry = {
          component: component.id,
          variant: variant.variant,
          signature: new Set(source.signature),
          tree: source.tree,
          textProps: component.textProps ?? [],
        }
        for (const root of source.signature.filter((name) => !name.startsWith('>'))) {
          const list = index.get(root) ?? []
          list.push(entry)
          index.set(root, list)
        }
      }
    }
  }
  return index
}

/** Variant for the element's classes; `null`: not a registry component, or a combination outside the matrix. */
export function matchSignature(
  index: TSignatureIndex,
  classes: string[],
  selfId: string | null = null,
): { entry: ISignatureEntry | null; component: string | null } {
  const own = new Set(classes)
  const roots = classes.filter((name) => index.has(name))
  let best: ISignatureEntry | null = null
  let seenComponent: string | null = null
  for (const root of roots) {
    for (const entry of index.get(root)!) {
      if (entry.component === selfId) continue
      seenComponent = entry.component
      if (![...entry.signature].every((name) => own.has(name))) continue
      const rank = stateRank(entry.variant)
      if (
        !best ||
        entry.signature.size > best.signature.size ||
        (entry.signature.size === best.signature.size && rank < stateRank(best.variant))
      ) {
        best = entry
      }
    }
  }
  return { entry: best, component: seenComponent }
}

function firstText(node: TLayerNode): string | null {
  if (node.type === 'text') return node.text
  if (node.type !== 'frame') return null
  for (const child of node.children) {
    const text = firstText(child)
    if (text !== null) return text
  }
  return null
}

const SIZE_EPSILON = 1.01

function sizeOf(box: IBox): string {
  return `${Math.round(box.w)}×${Math.round(box.h)}`
}

/**
 * How the captured subtree differs from the component set variant; `null` means an instance can be substituted.
 * Compared are the type and number of children, the look of frames, the text style and its content outside
 * text properties, and the sizes of fixed sides: on hug sides and auto-width text the size is set by the
 * content, and the label the instance overrides itself. Otherwise a stretched form field would become an
 * instance with a narrow input and a foreign value.
 */
export function divergence(
  node: TLayerNode,
  variantTree: TLayerNode,
  textProps: ITextProp[],
  rootPath = node.path,
): string | null {
  const relative = (path: string): string => (path.startsWith(rootPath) ? path.slice(rootPath.length) : path)
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
  // Numbers of the text style (font size, line height in px) are compared with a tolerance: rounding during
  // capture of different stories diverges in hundredths, yet it is the same style.
  const sameStyle = (a: ITextStyleValues, b: ITextStyleValues): boolean =>
    (Object.keys({ ...a, ...b }) as (keyof ITextStyleValues)[]).every((key) =>
      typeof a[key] === 'number' && typeof b[key] === 'number'
        ? Math.abs(a[key] - b[key]) <= 0.05
        : same(a[key], b[key]),
    )
  // `b` has the type of `a` past the first check: the trees are compared node by node.
  const walk = (a: TLayerNode, b: TLayerNode): string | null => {
    const at = relative(a.path) || '/'
    if (a.type !== b.type) return `${at}: ${a.type} вместо ${b.type}`
    if (a.type === 'text') {
      if (Math.abs(a.box.h - b.box.h) > SIZE_EPSILON) return `${at}: высота текста ${sizeOf(a.box)} ≠ ${sizeOf(b.box)}`
      if (a.autoResize !== 'both' && Math.abs(a.box.w - b.box.w) > SIZE_EPSILON) return `${at}: ширина текста`
      if (!textProps.some((prop) => prop.path === relative(a.path)) && a.text !== (b as ITextNode).text) {
        return `${at}: текст «${a.text}» ≠ «${(b as ITextNode).text}»`
      }
      if (!sameStyle(a.style, (b as ITextNode).style)) return `${at}: стиль текста`
      if (!same(a.color, (b as ITextNode).color)) return `${at}: цвет текста`
      return null
    }
    if (a.type === 'svg') return a.asset === (b as ISvgNode).asset ? null : `${at}: другая иконка`
    if (a.type === 'instance') {
      return a.component === (b as IInstanceNode).component && same(a.variant, (b as IInstanceNode).variant)
        ? null
        : `${at}: другой экземпляр`
    }
    if ((a.sizing?.w ?? 'fixed') !== 'hug' && Math.abs(a.box.w - b.box.w) > SIZE_EPSILON) {
      return `${at}: ширина ${sizeOf(a.box)} ≠ ${sizeOf(b.box)}`
    }
    if ((a.sizing?.h ?? 'fixed') !== 'hug' && Math.abs(a.box.h - b.box.h) > SIZE_EPSILON) {
      return `${at}: высота ${sizeOf(a.box)} ≠ ${sizeOf(b.box)}`
    }
    for (const key of ['fills', 'stroke', 'radius', 'effects', 'opacity', 'clip'] as const) {
      if (!same(a[key], (b as IFrameNode)[key])) return `${at}: ${key}`
    }
    if (a.layout.mode !== (b as IFrameNode).layout.mode) return `${at}: раскладка`
    if (a.children.length !== (b as IFrameNode).children.length)
      return `${at}: детей ${a.children.length} ≠ ${(b as IFrameNode).children.length}`
    for (const [index, child] of a.children.entries()) {
      const other = (b as IFrameNode).children[index]
      // Child position outside auto layout is part of the look (the LinearProgress bar is shifted by its value).
      const placed = a.layout.mode === 'none' || child.absolute
      if (
        placed &&
        (Math.abs(child.box.x - other.box.x) > SIZE_EPSILON || Math.abs(child.box.y - other.box.y) > SIZE_EPSILON)
      ) {
        return `${relative(child.path) || '/'}: положение ${Math.round(child.box.x)},${Math.round(child.box.y)}`
      }
      const reason = walk(child, other)
      if (reason) return reason
    }
    return null
  }
  return walk(node, variantTree)
}

/** Node classes together with the classes of first-level children (prefixed with `>`), as in a variant signature. */
export function classesWithChildren(node: IFrameNode): string[] {
  const children = node.children ?? []
  return [...(node.classes ?? []), ...children.flatMap((child) => (child.classes ?? []).map((name) => `>${name}`))]
}

/**
 * Replaces tree nodes with instances of component sets. Classes are stripped from the nodes: they are not part
 * of the export. A node that differs from the variant (a stretched field, different text outside the label)
 * stays as layers: `kept` lists such nodes with the reason.
 */
export function replaceInstances(
  tree: TLayerNode,
  index: TSignatureIndex,
  { selfId = null, where = '' }: { selfId?: string | null; where?: string } = {},
): { tree: TLayerNode; dependsOn: string[]; outOfMatrix: string[]; kept: string[] } {
  const dependsOn = new Set<string>()
  const outOfMatrix: string[] = []
  const kept: string[] = []
  const visit = (node: TLayerNode, isRoot: boolean): TLayerNode => {
    if (node.type !== 'frame') return node
    const classes = classesWithChildren(node)
    delete node.classes
    if (!isRoot && classes.length > 0) {
      const { entry, component } = matchSignature(index, classes, selfId)
      const reason = entry?.tree?.type ? divergence(node, entry.tree, entry.textProps) : null
      if (entry && reason) kept.push(`${where}${node.path ? ` ${node.path}` : ''}: ${entry.component} - ${reason}`)
      if (entry && !reason) {
        dependsOn.add(entry.component)
        const label = firstText(node)
        return {
          type: 'instance',
          path: node.path,
          name: entry.component,
          box: node.box,
          component: entry.component,
          variant: entry.variant,
          overrides: { text: label === null ? {} : { Label: label } },
          ...(node.absolute ? { absolute: true } : {}),
          ...(node.grow ? { grow: node.grow } : {}),
          ...(node.alignSelf ? { alignSelf: node.alignSelf } : {}),
        }
      }
      if (component)
        outOfMatrix.push(`${where}${node.path ? ` ${node.path}` : ''}: ${component} (${classes.join(' ')})`)
    }
    node.children = node.children.map((child) => visit(child, false))
    return node
  }
  const result = visit(tree, true)
  stripClasses(result)
  return { tree: result, dependsOn: [...dependsOn], outOfMatrix, kept }
}

/** Strips `classes` from the whole tree: they are not part of the export. */
export function stripClasses(node: TLayerNode): void {
  delete node.classes
  if (node.type === 'frame') for (const child of node.children) stripClasses(child)
}
