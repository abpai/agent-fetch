import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const parseEnvFile = (source: string): Record<string, string> => {
  const out: Record<string, string> = {}

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const equalsIndex = trimmed.indexOf('=')
    if (equalsIndex <= 0) {
      continue
    }

    const key = trimmed.slice(0, equalsIndex).trim()
    const rawValue = trimmed.slice(equalsIndex + 1).trim()
    out[key] = stripQuotes(rawValue)
  }

  return out
}

const stripQuotes = (value: string): string => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }

  return value
}

export const readEnvFile = async (filePath: string): Promise<Record<string, string>> => {
  try {
    const source = await readFile(filePath, 'utf-8')
    return parseEnvFile(source)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw error
  }
}

const quoteEnvValue = (value: string): string => {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
    return value
  }

  return JSON.stringify(value)
}

export const writeEnvFile = async (
  filePath: string,
  values: Record<string, string>,
  overwrite: boolean
): Promise<void> => {
  try {
    await stat(filePath)
    if (!overwrite) {
      throw new Error(`${filePath} already exists. Re-run with --overwrite to replace it.`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }

  await mkdir(dirname(filePath), { recursive: true })
  const lines = Object.entries(values).map(([key, value]) => `${key}=${quoteEnvValue(value)}`)
  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf-8')
  await chmod(filePath, 0o600)
}
