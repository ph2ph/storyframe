/*
 * Component sets the export discovers in the catalog on its own: the item's "Basic" story becomes a set if it
 * has a component root by the `<Prefix><Name>-root` class. Axes come from the story's `argTypes` (a select
 * with a list of values and boolean flags), states from the presence of the `disabled` and `error` flags. The
 * rules are common to any Storybook catalog: there is no knowledge of a specific theme here, exclusions with
 * their reasons live in the configuration.
 */

/** Matrix limit of a discovered component set: extra axes are dropped, flags first, the rest from the end. */
export const AUTO_MAX_VARIANTS = 64

/** Flags that modify behavior or stretching to the container: they do not define the variant's appearance. */
const MODIFIER_FLAG = /^(disable|enable|keep|auto|resume|hide|full)/
/** Flags captured as states (the `State` axis) rather than as axes. */
const STATE_FLAGS = ['disabled', 'error']
/** Axis values that inherit the color from the context and do not form a variant. */
const EXCLUDED_VALUES = ['inherit']

function axisName(arg) {
  return arg.charAt(0).toUpperCase() + arg.slice(1)
}

/** The title's "Basic" story (`…--basic`), otherwise the first one. */
export function pickStory(stories) {
  return stories.find((story) => story.id.endsWith('--basic')) ?? stories[0]
}

/**
 * Axes from `argTypes`: a select with a list of values (without `inherit`) and boolean flags except states and
 * modifiers.
 */
export function autoAxes(argTypes) {
  const axes = []
  for (const [arg, type] of Object.entries(argTypes)) {
    if (Array.isArray(type.options) && type.control !== 'boolean') {
      const values = type.options.map(String).filter((value) => !EXCLUDED_VALUES.includes(value))
      if (values.length >= 2) axes.push({ name: axisName(arg), arg, exclude: EXCLUDED_VALUES, count: values.length })
    } else if (type.control === 'boolean' && !STATE_FLAGS.includes(arg) && !MODIFIER_FLAG.test(arg)) {
      axes.push({ name: axisName(arg), values: { false: { [arg]: false }, true: { [arg]: true } }, count: 2 })
    }
  }
  return axes
}

/** States: `hover` and `disabled` for components with the `disabled` flag, `error` for those with the `error` flag. */
export function autoStates(argTypes) {
  const states = ['default']
  if (argTypes.disabled?.control === 'boolean') states.push('hover', 'disabled')
  if (argTypes.error?.control === 'boolean') states.push('error')
  return states
}

/**
 * Entry of a discovered component set with axes and states from `argTypes`: the matrix is no larger than
 * `max`, extra axes are dropped (flags first, then lists from the end) and listed in `dropped`.
 */
export function resolveAutoEntry(entry, argTypes, max = AUTO_MAX_VARIANTS) {
  const states = autoStates(argTypes)
  const axes = autoAxes(argTypes)
  const dropped = []
  const size = () => axes.reduce((product, axis) => product * axis.count, states.length)
  while (axes.length > 0 && size() > max) {
    const flags = axes.map((axis, index) => ('values' in axis ? index : -1)).filter((index) => index >= 0)
    const index = flags.length > 0 ? flags[flags.length - 1] : axes.length - 1
    dropped.push(axes[index].name)
    axes.splice(index, 1)
  }
  const label = Object.values(argTypes).some((type) => type.control === 'text')
  return {
    ...entry,
    axes: axes.map(({ count, ...axis }) => {
      void count
      return axis
    }),
    states,
    label,
    dropped,
  }
}

/** The variant from a capture error message: `Axis=value` pairs before `(light)` or `(dark)`. */
export function failedVariant(message) {
  const match = / ((?:[A-Za-z]+=[^,()]+)(?:, [A-Za-z]+=[^,()]+)*) \((?:light|dark)\)/.exec(message)
  if (!match) return null
  return Object.fromEntries(
    match[1].split(', ').map((pair) => {
      const at = pair.indexOf('=')
      return [pair.slice(0, at), pair.slice(at + 1)]
    }),
  )
}

/** The axis default value, from the story args; for `State` it is `default`. */
export function defaultValue(entry, axisName, initialArgs) {
  if (axisName === 'State') return 'default'
  const axis = entry.axes.find((candidate) => candidate.name === axisName)
  if (!axis) return null
  const arg = 'values' in axis ? Object.keys(Object.values(axis.values)[0] ?? {})[0] : axis.arg
  return arg in initialArgs ? String(initialArgs[arg]) : null
}

/**
 * The entry without one axis value or state: this is how a discovered component set survives a value on
 * which the story fails (`multiple` without an array, a color missing from the palette). An axis with a single
 * remaining value is removed. `null` if there is nothing to remove.
 */
export function withoutValue(entry, axisName, value) {
  if (axisName === 'State') {
    const states = entry.states.filter((state) => state !== value)
    if (states.length === entry.states.length) return null
    return { ...entry, states: states.length > 0 ? states : ['default'] }
  }
  let changed = false
  const axes = []
  for (const axis of entry.axes) {
    if (axis.name !== axisName) {
      axes.push(axis)
      continue
    }
    changed = true
    if ('values' in axis) {
      const values = Object.fromEntries(Object.entries(axis.values).filter(([key]) => key !== value))
      if (Object.keys(values).length >= 2) axes.push({ ...axis, values })
    } else {
      axes.push({ ...axis, exclude: [...(axis.exclude ?? []), value] })
    }
  }
  return changed ? { ...entry, axes } : null
}

/**
 * Runs in the tab: the story root selector by the `<Prefix><Name>-root` class (one capitalized prefix: `Mui`
 * or the project's component prefix; `MuiOutlinedInput-root` does not fit `Input`), the first in the document;
 * otherwise the fallback.
 */
export function findRootSelector(win, id, fallback) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^[A-Z][a-z0-9]*[A-Z]?${escaped}-root$`)
  const scope = win.document.querySelector('#storybook-root') ?? win.document.body
  for (const element of scope.querySelectorAll('*')) {
    for (const token of element.classList) if (pattern.test(token)) return `.${token}`
  }
  return fallback
}
