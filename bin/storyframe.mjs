#!/usr/bin/env node
/*
 * Командная строка storyframe. Команда работает в папке проекта: там конфигурация (`storyframe.config.ts`),
 * сборка Storybook и рабочая папка.
 */

const COMMANDS = {
  export: {
    module: '../app/export/dataset.mjs',
    usage: 'export [--only <подстрока>] [--tabs 4] [--shots [папка]]',
    about: 'выгрузка для Figma из сборки Storybook и темы проекта',
  },
  serve: {
    module: '../app/export/serve.mjs',
    usage: 'serve [--port 6009] [--dir <папка>]',
    about: 'раздача сборки Storybook с CORS для загрузки выгрузки в плагин по ссылке',
  },
  'shots-server': {
    module: '../app/export/shots-server.mjs',
    usage: 'shots-server [--port 6010] [--dir <папка>]',
    about: 'приёмник снимков из плагина («Отправить снимки»)',
  },
  compare: {
    module: '../app/export/compare.mjs',
    usage: 'compare [--storybook <папка>] [--figma <папка>] [--out <папка>] [--top 20] [--threshold 24]',
    about: 'сверка снимков Storybook и Figma',
  },
  emulate: {
    module: '../app/export/emulate.mjs',
    usage: 'emulate [--kit <kit.json>] [--out <папка>] [--only <подстрока>]',
    about: 'эмуляция плагина в браузере и снимки для сверки без Figma',
  },
}

function help() {
  const lines = Object.values(COMMANDS).map((command) => `  storyframe ${command.usage}\n      ${command.about}`)
  return `Использование (в папке проекта):\n${lines.join('\n')}\n`
}

const [name, ...argv] = process.argv.slice(2)
const command = COMMANDS[name]
if (!command) {
  process.stderr.write(help())
  process.exit(name === undefined || name === 'help' || name === '--help' ? 0 : 1)
}
try {
  const { main } = await import(new URL(command.module, import.meta.url).href)
  process.exitCode = await main(argv, process.cwd())
} catch (error) {
  process.stderr.write(
    `storyframe ${name}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  )
  process.exitCode = 1
}
