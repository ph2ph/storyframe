import type { IStoryframeTheme } from '../theme.d.mts'

/**
 * Тема MUI в той мере, в какой её читает адаптер: результат `createTheme` подходит как есть. Тип открытый,
 * чтобы storyframe не зависел от версии `@mui/material`.
 */
export interface IMuiThemeLike {
  palette?: object
  shape?: object
  spacing: (step: number) => string | number
  typography?: object
  shadows?: readonly string[]
}

export interface IMuiThemeOptions {
  light: IMuiThemeLike
  /** Тёмная тема; без неё оба режима берут светлую. */
  dark?: IMuiThemeLike
  /** Шрифты темы и их начертания. По умолчанию - семейства и начертания стилей текста. */
  fonts?: { family: string; weights: number[] }[]
  /** Скругления: ключ `theme.shape` → имя переменной (`borderRadius` → `md`). По умолчанию - все числа `shape`. */
  radii?: Record<string, string>
  /** Шаги `theme.spacing(n)` - переменные отступов. По умолчанию 0.5, 1, 1.5, 2, 3, 4, 6, 8. */
  spacing?: number[]
  /** Имена теней по номеру `theme.shadows` (`{ 1: 'xs' }`). По умолчанию - номер. */
  shadowNames?: Record<number, string>
  /** Дополнительные стили текста: варианты с другим семейством (`Typography/mono/body1`). */
  extraTypography?: { prefix: string; fontFamily: string; variants: string[] }[]
  /** Свечение полотна: адрес значения в теме (`palette.background.gradient`) или функция от темы режима. */
  canvas?: string | ((theme: IMuiThemeLike) => string | undefined)
  /** Описание токена по адресу (`palette.primary.main`, `shape.borderRadius`). */
  describe?: (address: string) => string | undefined
  /** Роли оформления плагина поверх ролей MUI по умолчанию. */
  roles?: Partial<Record<keyof typeof MUI_ROLES, string>>
  /**
   * Приоритеты цветов с одинаковыми значениями по роли краски вместо `MUI_COLOR_PRIORITY` (списки ролей
   * заменяются целиком): первый подходящий шаблон адреса побеждает. Для палитры с расширениями.
   */
  colorPriority?: Partial<Record<'fill' | 'text' | 'stroke', RegExp[]>>
  /** Какие адреса палитры - цвета текста, вместо `MUI_TEXT_COLOR`. */
  textColor?: RegExp
  /** Ключ `theme.shape` со скруглением «до круга» (таблетки, аватары). */
  circleRadius?: string
}

export const MUI_ROLES: {
  canvas: string
  text: string
  textSecondary: string
  textDisabled: string
  divider: string
  title: string
  heading: string
  subheading: string
  body: string
  caption: string
}

export const MUI_COLOR_PRIORITY: Record<'fill' | 'text' | 'stroke', RegExp[]>

export const MUI_TEXT_COLOR: RegExp

export function muiTheme(options: IMuiThemeOptions): IStoryframeTheme
