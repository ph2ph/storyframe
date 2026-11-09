#!/usr/bin/env node
/*
 * The storyframe command line. A command runs in the project folder: that is where the configuration
 * (`storyframe.config.ts`), the Storybook static build and the working folder are.
 */

/** A command module: `main` resolves to the process exit code (the servers never settle). */
interface ICommandModule {
  main: (argv: string[], root: string) => Promise<number | undefined>
}

interface ICommand {
  load: () => Promise<ICommandModule>
  usage: string
  about: string
}

const COMMANDS: Record<string, ICommand> = {
  export: {
    load: () => import('../app/export/dataset.ts'),
    usage: 'export [--only <substring>] [--tabs 4] [--shots [folder]]',
    about: 'export for Figma from the Storybook static build and the project theme',
  },
  serve: {
    load: () => import('../app/export/serve.ts'),
    usage: 'serve [--port 6009] [--dir <folder>]',
    about: 'serving of the Storybook static build with CORS to load the export into the plugin by URL',
  },
  'shots-server': {
    load: () => import('../app/export/shots-server.ts'),
    usage: 'shots-server [--port 6010] [--dir <folder>]',
    about: 'receiver of screenshots from the plugin ("Send screenshots")',
  },
  compare: {
    load: () => import('../app/export/compare.ts'),
    usage: 'compare [--storybook <folder>] [--figma <folder>] [--out <folder>] [--top 20] [--threshold 24]',
    about: 'comparison of Storybook and Figma screenshots',
  },
  emulate: {
    load: () => import('../app/export/emulate.ts'),
    usage: 'emulate [--kit <kit.json>] [--out <folder>] [--only <substring>]',
    about: 'plugin emulation in the browser and screenshots for comparison without Figma',
  },
}

function help() {
  const lines = Object.values(COMMANDS).map((command) => `  storyframe ${command.usage}\n      ${command.about}`)
  return `Usage (run in the project folder):\n${lines.join('\n')}\n`
}

const [name, ...argv] = process.argv.slice(2)
const command: ICommand | undefined = COMMANDS[name]
if (!command) {
  process.stderr.write(help())
  process.exit(name === undefined || name === 'help' || name === '--help' ? 0 : 1)
}
try {
  const { main } = await command.load()
  process.exitCode = await main(argv, process.cwd())
} catch (error) {
  process.stderr.write(
    `storyframe ${name}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  )
  process.exitCode = 1
}
