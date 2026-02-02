/**
 * Environment configuration
 *
 * Provides typed access to environment variables with defaults
 */
import { config } from 'dotenv'
import path from 'path'

// Load .env file from project root
config({ path: path.resolve(process.cwd(), '.env') })

interface Environment {
  NODE_ENV: 'development' | 'production' | 'test'
  PORT: number
  LOG_LEVEL: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  ALLOWED_ORIGINS: string[]
  DATABASE_URL: string
  OPENAI_API_KEY: string
  TRACKS_RAW_DIR: string
}

// Define and export environment with defaults
export const env: Environment = {
  NODE_ENV: (process.env.NODE_ENV as Environment['NODE_ENV']) || 'development',
  PORT: parseInt(process.env.PORT || '3000', 10),
  LOG_LEVEL: (process.env.LOG_LEVEL as Environment['LOG_LEVEL']) || 'info',
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim())
    : [],
  DATABASE_URL: process.env.DATABASE_URL || 'postgres://crawl:crawl@localhost:5432/crawl',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
  TRACKS_RAW_DIR:
    process.env.TRACKS_RAW_DIR || path.join(process.env.HOME || '~', '.tracks', 'raw'),
}

export default env
