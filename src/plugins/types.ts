export interface PluginContext {
  headers: Record<string, string>
  timeout: number
  environment: Record<string, string>
}

export interface FetchPlugin {
  name: string
  fetch(
    url: string,
    config: Record<string, unknown>,
    context: PluginContext,
  ): Promise<string>
}

export interface BuiltinPluginSpec {
  type: string
  description: string
  requiredConfig: string[]
  optionalConfig: string[]
}
