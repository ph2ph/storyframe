# storyframe

Дизайн-система в Figma из каталога Storybook. В этом пакете две части:

- **Выгрузка** (`storyframe export`): headless Chrome открывает статическую сборку Storybook, снимает
  истории в дерево слоёв (auto layout, заливки, обводки, тени, текст, SVG) и собирает `kit.json` и `kit.zip`
  вместе с токенами темы проекта.
- **Блок «Варианты»** для страниц документации Storybook: те же наборы, оси и состояния, что в Figma,
  чтобы примеры в каталоге и в файле совпадали.

Выгрузку читает плагин Figma storyframe. Он живёт в отдельном репозитории `storyframe-plugin` и строит из
неё нативные переменные Light/Dark, стили текста и эффектов, наборы компонентов с вариантами и истории
фреймами; повторный запуск обновляет файл по месту. Формат выгрузки плагин берёт из этого пакета, поэтому
сборщик и плагин всегда говорят на одном языке.

Пакет ничего не знает о конкретном каталоге: страницы, наборы с особыми осями и тема задаются в проекте.

## Требования

- Node 24 (не ниже 22.22.1): пакет поставляется исходниками, `.ts` Node выполняет сам.
- Статическая сборка Storybook 10 (`storybook build`) с React и Vite.
- Chrome или Chromium для съёмки: по умолчанию `google-chrome`, другой путь - переменная `CHROME`.
- Vite в проекте, если задан модуль темы (он грузится через Vite SSR).

## Подключение

Пакет публикуется в npmjs под именем `@ph2ph/storyframe`, команда CLI называется `storyframe`:

```bash
yarn add -D @ph2ph/storyframe
```

## Конфигурация

`storyframe.config.ts` (или `.mjs`) в корне проекта. Без файла выгрузка строит страницу на каждый раздел
верхнего уровня каталога и сама находит наборы по классу корня `<Префикс><Имя>-root`.

```ts
import { defineConfig } from '@ph2ph/storyframe/config'

export default defineConfig({
  // Пути - от корня проекта; ниже значения по умолчанию.
  storybook: 'storybook-static',
  out: 'storybook-static/figma-data',
  workDir: '.storyframe',
  // Модуль темы: без него выгрузка идёт без переменных и стилей.
  theme: './storyframe.theme.ts',
  storyUrl: 'https://storybook.example.com',
  pages: [
    { id: 'components', name: 'Компоненты', include: ['Компоненты', 'Компоненты MUI'] },
    { id: 'icons', name: 'Иконки', include: ['Компоненты/Иконки'] },
  ],
  exclude: ['Внутреннее'],
  skip: { Modal: 'портал: содержимое рисуется вне корня истории' },
  components: [
    {
      id: 'Button',
      name: 'Inputs/Button',
      storyId: 'компоненты-mui-inputs-button--basic',
      storyFile: 'src/Button.stories.tsx',
      root: '.MuiButton-root',
      axes: [
        { name: 'Variant', arg: 'variant' },
        { name: 'Color', arg: 'color', exclude: ['inherit'] },
      ],
      states: ['default', 'hover', 'disabled'],
      label: true,
    },
  ],
  unboundExceptions: { Button: 'подложка contained - производный цвет darken(main)' },
  layout: { maxWidth: 1980 },
})
```

`.storyframe/` стоит добавить в `.gitignore`.

## Тема

Модуль темы отдаёт экспортом по умолчанию тему в формате storyframe (тип `IStoryframeTheme` из
`@ph2ph/storyframe/config`) - объект или функцию, можно асинхронную. Значения в CSS, как их пишет тема компонентов:
цвета светлого и тёмного режима, числа скруглений и отступов, стили текста, тени, свечение полотна, шрифты и
роли оформления плагина.

Для MUI формат строит адаптер:

```ts
import { muiTheme } from '@ph2ph/storyframe/mui'
import { darkTheme, lightTheme } from './src/theme'

export default () =>
  muiTheme({
    light: lightTheme,
    dark: darkTheme,
    fonts: [{ family: 'Inter', weights: [400, 500, 700] }],
    radii: { borderRadius: 'md' },
    shadowNames: { 1: 'soft', 2: 'raised' },
    extraTypography: [{ prefix: 'mono', fontFamily: '"JetBrains Mono", monospace', variants: ['body2'] }],
    canvas: 'palette.background.gradient',
    describe: (address) => (address === 'palette.primary.main' ? 'Цвет действий' : undefined),
  })
```

Роли оформления (`canvas`, `text`, `textSecondary`, `textDisabled`, `divider`, `title`, `heading`,
`subheading`, `body`, `caption`) - адреса токенов, которыми плагин рисует полотно, подписи и рамки
документации. У адаптера MUI они по умолчанию указывают на `palette.background.default`, `palette.text.*`,
`palette.divider` и варианты `typography`; опция `roles` их переопределяет.

Соглашения проекта о токенах тоже приходят из темы, ядро адресов не разбирает:

- `code` - как токен пишут в коде (`theme.palette.primary.main`, `var(--color-primary)`): подсказка в описании
  и синтаксис кода переменной в Dev Mode;
- `group` и `priority` (цвета) - выбор среди токенов с одинаковыми значениями: меньший приоритет для роли
  краски (`fill`, `text`, `stroke`) побеждает, при равных - группа соседнего слоя, затем короче адрес;
- `text` (цвета) - цвет текста: переменная предлагается тексту и фигурам, но не заливке фреймов;
- `circle` (скругления) - скругление «до круга»: привязывается к углам не меньше половины меньшей стороны.

Адаптер MUI заполняет их по соглашениям MUI (`MUI_COLOR_PRIORITY`, `MUI_TEXT_COLOR`). Палитра с расширениями
передаёт свои списки опциями `colorPriority` и `textColor`, ключ скругления «до круга» - опцией
`circleRadius`.

## Команды

Команда работает в папке проекта:

```bash
storyframe export [--only <подстрока>] [--tabs 4]  # выгрузка в <out>: kit.json, kit.zip, index.json
storyframe export --shots [папка]                  # то же плюс эталонные PNG для сверки
storyframe serve                                   # сборка Storybook с CORS на localhost:6009
storyframe shots-server                            # приёмник снимков из плагина на localhost:6010
storyframe emulate [--only <подстрока>]            # эмуляция плагина в браузере: снимки слоёв kit.json
storyframe compare                                 # сверка снимков Figma (или эмуляции) с эталонами
```

`--only` выгружает часть каталога для проверки. Такую выгрузку не применяйте к рабочему файлу Figma: папки и
пункты, которых в ней нет, плагин уберёт (наборы из них переедут в «Устаревшее»).

Съёмка держит открытыми `--tabs` вкладок Chrome; на машине без запаса памяти берите `--tabs 2`.

## Блок «Варианты» в Storybook

Нужны `@storybook/addon-docs` и аддон `storybook-addon-pseudo-states` (наведение и фокус в ячейках).

```tsx
// .storybook/preview.tsx
import { createDocsPage, isVariantsCell } from '@ph2ph/storyframe/storybook'
import config from '../storyframe.config'

export default {
  parameters: { docs: { page: createDocsPage(config) } },
  decorators: [
    (Story, context) => {
      // Ячейке матрицы не нужны поля и фон отдельной истории.
      const cell = isVariantsCell(context.parameters)
      return (
        <div style={{ padding: cell ? 0 : 24 }}>
          <Story />
        </div>
      )
    },
  ],
}
```

Свою страницу документации можно собрать из блока `Variants` с пропом `config`.

## Плагин Figma

Плагин разрабатывается в репозитории `storyframe-plugin`: там его сборка, тесты и инструкция для дизайнера.
Этот пакет отдаёт плагину общий код тремя точками входа:

- `@ph2ph/storyframe/format`: типы формата выгрузки и `SCHEMA_VERSION`;
- `@ph2ph/storyframe/variants`: подписи осей и состояний матрицы вариантов, общие для Figma и блока
  «Варианты»;
- `@ph2ph/storyframe/zip`: писатель ZIP, которым плагин собирает свой архив.

Формат выгрузки меняется вместе: `app/export/capture/types.ts`, `schema.mjs` и код плагина. Несовместимое
изменение поднимает `SCHEMA_VERSION`, и плагин отказывается применять выгрузку другой схемы.

## Разработка

```bash
yarn test          # vitest: сборщик, конвертер DOM, адаптер MUI
yarn typecheck     # tsc по пакету
yarn lint
yarn format
```

Проверка плагина на настоящей выгрузке проекта живёт в репозитории `storyframe-plugin`.

## Лицензия

MIT, текст в файле [LICENSE](LICENSE). Пакет можно использовать, менять и распространять в любых проектах,
в том числе коммерческих, при сохранении уведомления об авторских правах.
