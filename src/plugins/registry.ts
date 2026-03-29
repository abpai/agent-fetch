import type { PluginConfig } from '../core/types'
import { scrapeDoPlugin } from './scrape-do'
import type { BuiltinPluginSpec, FetchPlugin } from './types'

interface BuiltinPluginDefinition {
  plugin: FetchPlugin
  spec: BuiltinPluginSpec
}

const BUILTIN_PLUGINS: Record<string, BuiltinPluginDefinition> = {
  'scrape-do': {
    plugin: scrapeDoPlugin,
    spec: {
      type: 'scrape-do',
      description: 'Use scrape.do hosted rendering and anti-bot fetch',
      requiredConfig: ['token'],
      optionalConfig: ['endpoint', 'params', 'headers', 'timeout'],
    },
  },
}

function resolveEnvVars(value: unknown, environment: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([^}]+)\}/g, (_, name) => {
      const resolved = environment[name.trim()]
      return resolved ?? ''
    })
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveEnvVars(entry, environment))
  }

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      out[key] = resolveEnvVars(nested, environment)
    }
    return out
  }

  return value
}

export const listBuiltinPlugins = (): BuiltinPluginSpec[] =>
  Object.values(BUILTIN_PLUGINS).map((entry) => entry.spec)

export const resolvePlugins = (
  pluginConfigs: PluginConfig[],
  environment: Record<string, string>,
): Array<{ plugin: FetchPlugin; config: Record<string, unknown> }> => {
  const resolved: Array<{ plugin: FetchPlugin; config: Record<string, unknown> }> = []

  for (const entry of pluginConfigs) {
    const { type, ...rest } = entry
    const definition = BUILTIN_PLUGINS[type]
    if (!definition) {
      throw new Error(`Unknown plugin type: ${type}`)
    }

    const resolvedConfig = resolveEnvVars(rest, environment) as Record<string, unknown>
    resolved.push({ plugin: definition.plugin, config: resolvedConfig })
  }

  return resolved
}

export const registerPlugin = (
  type: string,
  plugin: FetchPlugin,
  spec?: Omit<BuiltinPluginSpec, 'type'>,
): void => {
  BUILTIN_PLUGINS[type] = {
    plugin,
    spec: {
      type,
      description: spec?.description ?? 'Custom plugin',
      requiredConfig: spec?.requiredConfig ?? [],
      optionalConfig: spec?.optionalConfig ?? [],
    },
  }
}
