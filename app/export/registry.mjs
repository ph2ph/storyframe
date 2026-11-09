/*
 * Общие правила наборов выгрузки: как воспроизвести состояние оси `State` и форма записи набора с особыми
 * осями. Записи конкретного каталога живут в его конфигурации (`storyframe.config.mjs`, раздел `components`).
 */

/**
 * @typedef {{ name: string, arg: string, exclude?: string[] } | { name: string, values: Record<string, object> }} TAxis
 * @typedef {{ id: string, name: string, storyId: string, storyFile: string, root: string, axes: TAxis[], states: string[], label?: boolean, fixedArgs?: object, dependsOn?: string[], stateArgs?: Record<string, object> }} TRegistryEntry
 *
 * `stateArgs` - аргументы, которыми состояние показывается без взаимодействия (поле с `focused`): ими
 * пользуется матрица документации Storybook, где фокус может быть лишь у одной ячейки. Выгрузка ставит
 * состояние по-настоящему и их не читает.
 */

/** Состояния оси `State`: как воспроизвести - аргументами, псевдоклассом или фокусом. */
export const STATES = {
  default: {},
  hover: { pseudo: ['hover'] },
  focus: { focus: true },
  disabled: { args: { disabled: true } },
  error: { args: { error: true } },
}
