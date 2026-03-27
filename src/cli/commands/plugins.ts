import { listBuiltinPlugins } from '../../plugins/registry.js'
import type { PluginsListCommand } from '../types.js'

interface PluginsListDependencies {
  output: (message: string) => void
}

export const runPluginsListCommand = (
  command: PluginsListCommand,
  dependencies: PluginsListDependencies,
): number => {
  const plugins = listBuiltinPlugins()

  if (command.json) {
    dependencies.output(JSON.stringify({ plugins }, null, 2))
    return 0
  }

  if (plugins.length === 0) {
    dependencies.output('No built-in plugins registered.')
    return 0
  }

  const lines = ['Built-in plugins:']
  for (const plugin of plugins) {
    const required =
      plugin.requiredConfig.length > 0 ? plugin.requiredConfig.join(', ') : 'none'
    const optional =
      plugin.optionalConfig.length > 0 ? plugin.optionalConfig.join(', ') : 'none'

    lines.push(`- ${plugin.type}: ${plugin.description}`)
    lines.push(`  required: ${required}`)
    lines.push(`  optional: ${optional}`)
  }

  dependencies.output(lines.join('\n'))
  return 0
}
