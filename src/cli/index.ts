import { Command, CommanderError, InvalidArgumentError } from 'commander'
import { runFetchCommand } from './commands/fetch'
import { runPluginsListCommand } from './commands/plugins'
import { runServerCommand } from './commands/server'
import { runSetupCommand } from './commands/setup'
import type { OutputMode } from '../core/types'
import type {
  FetchCommand,
  ParsedCommand,
  PluginsListCommand,
  ServerCommand,
  SetupCommand,
} from './types'

interface RunCliDependencies {
  output?: (message: string) => void
  error?: (message: string) => void
}

export function parseCliArgs(argv: string[]): ParsedCommand {
  return parseCli(argv).command
}

export async function runCli(
  argv: string[],
  dependencies: RunCliDependencies = {},
): Promise<number> {
  const output = dependencies.output ?? console.log
  const error = dependencies.error ?? console.error

  try {
    const parsed = parseCli(argv)

    switch (parsed.command.command) {
      case 'help':
        output(parsed.helpText)
        return 0
      case 'fetch':
        return runFetchCommand(parsed.command, { output, error })
      case 'setup':
        await runSetupCommand(parsed.command)
        return 0
      case 'plugins-list':
        return runPluginsListCommand(parsed.command, { output })
      case 'server':
        return await runServerCommand(parsed.command, { error })
      default:
        error('Unknown command.')
        return 2
    }
  } catch (unknownError) {
    const message =
      unknownError instanceof Error ? unknownError.message : 'Unexpected CLI failure.'
    error(message)
    return 1
  }
}

interface ParseResult {
  command: ParsedCommand
  helpText: string
}

function parseCli(argv: string[]): ParseResult {
  const normalizedArgv = normalizeCliArgs(argv)
  let parsedCommand: ParsedCommand | undefined
  let renderedHelpText = ''
  const program = buildProgram(
    (command) => {
      parsedCommand = command
    },
    (chunk) => {
      renderedHelpText += chunk
    },
  )

  if (normalizedArgv.length === 0) {
    return {
      command: { command: 'help' },
      helpText: program.helpInformation(),
    }
  }

  try {
    program.parse(normalizedArgv, { from: 'user' })
  } catch (unknownError) {
    if (
      unknownError instanceof CommanderError &&
      unknownError.code === 'commander.helpDisplayed'
    ) {
      return {
        command: { command: 'help' },
        helpText: renderedHelpText || program.helpInformation(),
      }
    }

    if (unknownError instanceof CommanderError) {
      throw new Error(normalizeCommanderError(unknownError.message))
    }

    throw unknownError
  }

  if (!parsedCommand) {
    return {
      command: { command: 'help' },
      helpText: program.helpInformation(),
    }
  }

  return {
    command: parsedCommand,
    helpText: program.helpInformation(),
  }
}

function normalizeCliArgs(argv: string[]): string[] {
  if (argv.length === 0) {
    return argv
  }

  if (shouldUsePluginsListShorthand(argv)) {
    return ['plugins', 'list', ...argv.slice(1)]
  }

  return isLikelyUrl(argv[0]) ? ['fetch', ...argv] : argv
}

function shouldUsePluginsListShorthand(argv: string[]): boolean {
  if (argv[0] !== 'plugins') {
    return false
  }

  const trailingArgs = argv.slice(1)
  if (trailingArgs.length === 0) {
    return true
  }

  if (trailingArgs.includes('-h') || trailingArgs.includes('--help')) {
    return false
  }

  return trailingArgs.every((arg) => arg.startsWith('-'))
}

function isLikelyUrl(value: string | undefined): boolean {
  if (!value) {
    return false
  }

  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function buildProgram(
  onParse: (command: ParsedCommand) => void,
  onHelpOutput: (chunk: string) => void,
): Command {
  const program = new Command()
  program
    .name('agent-fetch')
    .description('Robust URL fetch CLI for AI agents with fallback strategies.')
    .showHelpAfterError()
    .exitOverride()
    .helpOption('-h, --help', 'Display help')
    .configureOutput({
      writeOut: onHelpOutput,
      writeErr: () => {},
    })

  registerFetchCommand(program, onParse)
  registerSetupCommand(program, onParse)
  registerPluginsCommand(program, onParse)
  registerServerCommand(program, onParse)

  return program
}

function registerFetchCommand(
  program: Command,
  onParse: (command: ParsedCommand) => void,
): void {
  program
    .command('fetch')
    .description('Fetch a URL with smart fallback and extraction')
    .argument('<url>', 'URL to fetch')
    .option('--json', 'Output structured JSON result')
    .option('--config <path>', 'Path to config JSON file')
    .option(
      '--method <method>',
      'Exact method: fetch, jsdom, agent-browser, scrape.do',
      parseMethod,
    )
    .option('--profile <path>', 'Persistent agent-browser profile path')
    .option('--no-jsdom', 'Disable jsdom fallback strategy')
    .option('--no-plugins', 'Disable plugin fallback strategies')
    .option('--no-agent-browser', 'Disable agent-browser fallback strategy')
    .option(
      '--mode <mode>',
      'Output mode: markdown, primary, html, structured, screenshot',
      parseOutputMode,
    )
    .option('--timeout <ms>', 'Timeout in milliseconds', positiveInt)
    .option(
      '--with-credentials',
      'Use authenticated mode and jump directly to agent-browser',
    )
    .option(
      '--strategy <mode>',
      'Strategy mode: auto, simple, authenticated',
      parseStrategyMode,
      'auto',
    )
    .option('--debug-attempts', 'Print per-attempt details to stderr')
    .action(
      (
        url: string,
        options: {
          json?: boolean
          config?: string
          method?: string
          profile?: string
          mode?: OutputMode
          jsdom?: boolean
          plugins?: boolean
          agentBrowser?: boolean
          timeout?: number
          withCredentials?: boolean
          strategy: 'auto' | 'simple' | 'authenticated'
          debugAttempts?: boolean
        },
      ) => {
        onParse({
          command: 'fetch',
          url,
          json: options.json === true,
          configPath: options.config,
          method: options.method,
          profile: options.profile,
          outputMode: options.mode,
          noJsdom: options.jsdom === false,
          noPlugins: options.plugins === false,
          noAgentBrowser: options.agentBrowser === false,
          timeout: options.timeout,
          withCredentials: options.withCredentials === true,
          strategy: options.strategy,
          debugAttempts: options.debugAttempts === true,
        } satisfies FetchCommand)
      },
    )
}

function registerSetupCommand(
  program: Command,
  onParse: (command: ParsedCommand) => void,
): void {
  program
    .command('setup')
    .alias('init')
    .description('Guided setup for authenticated browser credentials and defaults')
    .option(
      '--config <path>',
      'Config file path (default: ~/.config/agent-fetch/config.json)',
    )
    .option('--env-file <path>', 'Env file path (default: ~/.agent-fetch/.env)')
    .option('--no-input', 'Disable interactive prompts')
    .option('--overwrite', 'Overwrite existing setup files')
    .action(
      (options: {
        config?: string
        envFile?: string
        input?: boolean
        overwrite?: boolean
      }) => {
        onParse({
          command: 'setup',
          configPath: options.config,
          envFilePath: options.envFile,
          noInput: options.input === false,
          overwrite: options.overwrite === true,
        } satisfies SetupCommand)
      },
    )
}

function registerPluginsCommand(
  program: Command,
  onParse: (command: ParsedCommand) => void,
): void {
  const plugins = program
    .command('plugins')
    .description('Inspect built-in plugin providers')

  plugins
    .command('list')
    .description('List built-in plugins and config requirements')
    .option('--json', 'Output plugin info as JSON')
    .action((options: { json?: boolean }) => {
      onParse({
        command: 'plugins-list',
        json: options.json === true,
      } satisfies PluginsListCommand)
    })
}

function registerServerCommand(
  program: Command,
  onParse: (command: ParsedCommand) => void,
): void {
  program
    .command('server')
    .description('Start an HTTP server exposing fetch capabilities')
    .option('--port <port>', 'Port to listen on', positiveInt, 7411)
    .option('--host <host>', 'Host to bind to', '127.0.0.1')
    .option('--config <path>', 'Path to config JSON file')
    .action((options: { port: number; host: string; config?: string }) => {
      onParse({
        command: 'server',
        port: options.port,
        host: options.host,
        configPath: options.config,
      } satisfies ServerCommand)
    })
}

function positiveInt(raw: string): number {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('Expected a positive integer.')
  }

  return parsed
}

function parseStrategyMode(raw: string): 'auto' | 'simple' | 'authenticated' {
  const normalized = raw.trim().toLowerCase()
  if (
    normalized === 'auto' ||
    normalized === 'simple' ||
    normalized === 'authenticated'
  ) {
    return normalized
  }

  throw new InvalidArgumentError("Expected one of: 'auto', 'simple', 'authenticated'.")
}

function parseOutputMode(raw: string): OutputMode {
  const normalized = raw.trim().toLowerCase()
  if (
    normalized === 'markdown' ||
    normalized === 'primary' ||
    normalized === 'html' ||
    normalized === 'structured' ||
    normalized === 'screenshot'
  ) {
    return normalized
  }

  throw new InvalidArgumentError(
    "Expected one of: 'markdown', 'primary', 'html', 'structured', 'screenshot'.",
  )
}

function parseMethod(raw: string): string {
  const normalized = raw.trim().toLowerCase().replaceAll('.', '-')
  if (!normalized) {
    throw new InvalidArgumentError('Expected a non-empty method name.')
  }

  return normalized
}

function normalizeCommanderError(message: string): string {
  if (message.startsWith('error: ')) {
    return message.slice('error: '.length)
  }

  return message
}
