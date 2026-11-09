/*
 * Наборы, которые выгрузка находит в каталоге сама: «Базовая» история пункта становится набором, если в ней
 * есть корень компонента по классу `<Префикс><Имя>-root`. Оси - из `argTypes` истории (select со списком
 * значений и булевы флаги), состояния - по наличию флагов `disabled` и `error`. Правила общие для любого
 * каталога Storybook: знания о конкретной теме здесь нет, исключения с причинами живут в конфигурации.
 */

/** Предел матрицы найденного набора: лишние оси отбрасываются, флаги первыми, остальные с конца. */
export const AUTO_MAX_VARIANTS = 64

/** Флаги-модификаторы поведения или растяжения до контейнера: внешний вид варианта они не задают. */
const MODIFIER_FLAG = /^(disable|enable|keep|auto|resume|hide|full)/
/** Флаги, которые снимаются состояниями (ось `State`), а не осями. */
const STATE_FLAGS = ['disabled', 'error']
/** Значения осей, которые наследуют цвет от контекста и варианта не образуют. */
const EXCLUDED_VALUES = ['inherit']

function axisName(arg) {
  return arg.charAt(0).toUpperCase() + arg.slice(1)
}

/** «Базовая» история заголовка (`…--basic`), иначе первая. */
export function pickStory(stories) {
  return stories.find((story) => story.id.endsWith('--basic')) ?? stories[0]
}

/** Оси из `argTypes`: select со списком значений (без `inherit`) и булевы флаги кроме состояний и модификаторов. */
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

/** Состояния: `hover` и `disabled` у компонентов с флагом `disabled`, `error` - с флагом `error`. */
export function autoStates(argTypes) {
  const states = ['default']
  if (argTypes.disabled?.control === 'boolean') states.push('hover', 'disabled')
  if (argTypes.error?.control === 'boolean') states.push('error')
  return states
}

/**
 * Запись найденного набора с осями и состояниями по `argTypes`: матрица не больше `max`, лишние оси
 * отбрасываются (флаги первыми, затем списки с конца) и перечисляются в `dropped`.
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

/** Вариант из текста ошибки съёмки: пары `Ось=значение` перед `(light)` или `(dark)`. */
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

/** Значение оси по умолчанию - из аргументов истории; у `State` - `default`. */
export function defaultValue(entry, axisName, initialArgs) {
  if (axisName === 'State') return 'default'
  const axis = entry.axes.find((candidate) => candidate.name === axisName)
  if (!axis) return null
  const arg = 'values' in axis ? Object.keys(Object.values(axis.values)[0] ?? {})[0] : axis.arg
  return arg in initialArgs ? String(initialArgs[arg]) : null
}

/**
 * Запись без одного значения оси или состояния: так найденный набор переживает значение, на котором
 * история падает (`multiple` без массива, цвет, которого нет в палитре). Ось с единственным оставшимся
 * значением убирается. `null`, если убирать нечего.
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
 * Выполняется во вкладке: селектор корня истории по классу `<Префикс><Имя>-root` (один заглавный префикс:
 * `Mui` или префикс компонентов проекта; `MuiOutlinedInput-root` для `Input` не подходит), первый в документе; иначе запасной.
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
