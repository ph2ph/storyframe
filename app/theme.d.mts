/** Шрифт темы: семейство и начертания, которые нужны стилям текста. */
export interface IStoryframeFont {
  family: string
  weights: number[]
}

/**
 * Как токен пишут в коде проекта (`theme.palette.primary.main`, `var(--color-primary)`): подсказка в описании
 * и синтаксис кода переменной в Dev Mode. Без него - адрес токена.
 */
type TTokenCode = string

/**
 * Цвет: значения режимов в CSS (`#1976d2`, `rgba(0, 0, 0, 0.6)`). Без тёмного - одно значение на оба режима;
 * `null` - в этом режиме цвет не задан (переменная берёт значение другого режима с пометкой в описании).
 */
export interface IStoryframeColor {
  /** Адрес токена: по нему выгрузка привязывает цвета слоёв (`palette.primary.main`). */
  id: string
  /** Имя переменной Figma; по умолчанию адрес с `/` вместо точек. */
  name?: string
  light: string | null
  dark?: string | null
  description?: string
  code?: TTokenCode
  /**
   * Группа токена: если у нескольких токенов одинаковые значения, слой берёт токен той же группы, что у
   * соседних слоёв (подпись кнопки - `primary.contrastText` рядом с фоном `primary.main`).
   */
  group?: string
  /**
   * Приоритет среди токенов с одинаковыми значениями по роли краски (заливка, текст, обводка): меньше - выше,
   * без значения - после всех. Дальше выбор идёт по длине адреса.
   */
  priority?: { fill?: number; text?: number; stroke?: number }
  /** Цвет текста: в Figma переменная предлагается тексту и фигурам, но не заливке фреймов. */
  text?: boolean
}

/** Число: скругление или отступ. */
export interface IStoryframeNumber {
  id: string
  name: string
  value: number
  scope: 'radius' | 'gap'
  description?: string
  code?: TTokenCode
  /** Скругление «до круга» (таблетки, аватары): привязывается к углам не меньше половины меньшей стороны бокса. */
  circle?: boolean
}

/** Стиль текста: значения как в CSS, кегль в px. */
export interface IStoryframeTypography {
  id: string
  /** Имя стиля Figma; по умолчанию `Typography/<id>`. */
  name?: string
  fontFamily: string
  fontSize: number
  fontWeight?: number | string
  lineHeight?: number | string
  letterSpacing?: number | string
  textTransform?: string
  code?: TTokenCode
}

/** Тень: `box-shadow` режимов. */
export interface IStoryframeShadow {
  id: string
  /** Имя стиля эффекта; по умолчанию `Shadow/<id>`. */
  name?: string
  light: string
  dark?: string
  code?: TTokenCode
}

/**
 * Роли оформления плагина: адреса токенов темы, которыми плагин рисует полотно, подписи и рамки
 * документации. Без роли - нейтральные значения плагина.
 */
export interface IStoryframeRoles {
  canvas?: string
  text?: string
  textSecondary?: string
  textDisabled?: string
  divider?: string
  title?: string
  heading?: string
  subheading?: string
  body?: string
  caption?: string
}

/** Тема проекта в формате storyframe. */
export interface IStoryframeTheme {
  fonts: IStoryframeFont[]
  colors: IStoryframeColor[]
  numbers: IStoryframeNumber[]
  typography: IStoryframeTypography[]
  shadows: IStoryframeShadow[]
  /** Свечение полотна: CSS `radial-gradient(...)` режимов поверх цвета роли `canvas`. */
  canvas?: { light?: string; dark?: string }
  roles?: IStoryframeRoles
}
