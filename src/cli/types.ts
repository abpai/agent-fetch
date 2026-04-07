import type { OutputMode } from '../core/types'

export interface FetchCommand {
  command: 'fetch'
  url: string
  json: boolean
  configPath?: string
  method?: string
  profile?: string
  outputMode?: OutputMode
  noJsdom: boolean
  noPlugins: boolean
  noAgentBrowser: boolean
  timeout?: number
  withCredentials: boolean
  strategy: 'auto' | 'simple' | 'authenticated'
  debugAttempts: boolean
}

export interface SetupCommand {
  command: 'setup'
  configPath?: string
  envFilePath?: string
  noInput: boolean
  overwrite: boolean
}

export interface PluginsListCommand {
  command: 'plugins-list'
  json: boolean
}

export interface ServerCommand {
  command: 'server'
  port: number
  host: string
  configPath?: string
}

export interface HelpCommand {
  command: 'help'
}

export type ParsedCommand =
  | FetchCommand
  | SetupCommand
  | PluginsListCommand
  | ServerCommand
  | HelpCommand
