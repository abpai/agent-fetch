import { Kysely, PostgresDialect } from 'kysely'
import pg from 'pg'

import { env } from '../config/environment.js'

import type { Database } from './schema.js'

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
})

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
})

export async function closeDb(): Promise<void> {
  await db.destroy()
}
