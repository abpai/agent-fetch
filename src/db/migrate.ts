import fs from 'fs'
import path from 'path'
import pg from 'pg'

import { env } from '../config/environment.js'

async function migrate() {
  const client = new pg.Client({ connectionString: env.DATABASE_URL })

  try {
    await client.connect()
    console.log('Connected to database')

    // Ensure migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    // Get applied migrations
    const { rows: applied } = await client.query<{ name: string }>(
      'SELECT name FROM _migrations ORDER BY name',
    )
    const appliedSet = new Set(applied.map((r) => r.name))

    // Find migration files
    const migrationsDir = path.join(import.meta.dirname, 'migrations')
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`Skipping ${file} (already applied)`)
        continue
      }

      console.log(`Applying ${file}...`)
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')

      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file])
        await client.query('COMMIT')
        console.log(`Applied ${file}`)
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    }

    console.log('All migrations applied')
  } finally {
    await client.end()
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})
