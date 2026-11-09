/*
 * Build entry of the converter for the catalog page: esbuild bundles it into an IIFE, the builder injects it
 * into the tab and calls `window.__storyframeCapture.capture(selector, name)`.
 */

import { CONTENT_ROOT } from './types'
import { captureElement, type ICaptureResult } from './walk'

declare global {
  interface Window {
    __storyframeCapture: {
      capture(selector: string, name: string): ICaptureResult
      find(selector: string): Element | null
    }
  }
}

/**
 * Story content without wrappers: from the Storybook root downwards while the element has exactly one visible
 * child. Depends neither on the catalog decorator nor on the component library.
 */
function contentRoot(doc: Document): Element | null {
  let element: Element = doc.getElementById('storybook-root') ?? doc.getElementById('root') ?? doc.body
  for (;;) {
    const visible = [...element.children].filter((child) => {
      if (['SCRIPT', 'STYLE', 'TEMPLATE'].includes(child.tagName)) return false
      const rect = child.getBoundingClientRect()
      return rect.width > 0 || rect.height > 0
    })
    if (visible.length !== 1) return element
    element = visible[0]
  }
}

function find(selector: string): Element | null {
  return selector === CONTENT_ROOT ? contentRoot(document) : document.querySelector(selector)
}

window.__storyframeCapture = {
  find,
  capture(selector, name) {
    const root = find(selector)
    if (!root) throw new Error(`Нет элемента ${selector}`)
    return captureElement(window, root, name)
  },
}
