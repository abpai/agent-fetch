import fs from 'fs'
import path from 'path'
import readline from 'readline'

import { sql } from 'kysely'

import { db } from '../db/index.js'
import { env } from '../config/environment.js'
import type { ActivityType } from '../db/schema.js'

const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'mc_eid',
  'ref',
  'source',
  'ref_src',
]

interface TracksRow {
  schema_version: number
  ts: string
  app: string
  window_title: string
  url: string
  tab_title: string
  activity_type: 'active' | 'idle' | 'meeting'
  idle_seconds: number
  meeting_hint: boolean
  capture_error: string | null
}

interface ImportResult {
  file: string
  rowsImported: number
  sessionsCreated: number
  urlsLinked: number
}

interface SessionBuilder {
  start_at: Date
  end_at: Date
  app: string
  window_title: string
  url: string
  site: string
  activity_type: ActivityType
}

function normalizeUrl(
  rawUrl: string,
): { url_norm: string; domain: string; path: string } | null {
  if (!rawUrl) return null

  try {
    const url = new URL(rawUrl)

    for (const param of TRACKING_PARAMS) {
      url.searchParams.delete(param)
    }

    url.hostname = url.hostname.toLowerCase()
    const pathname = url.pathname.replace(/\/+$/, '') || '/'
    url.searchParams.sort()

    const url_norm = url.origin + pathname + (url.search || '')
    const domain = url.hostname.replace(/^www\./, '')

    return { url_norm, domain, path: pathname }
  } catch {
    return null
  }
}

function extractSite(url: string): string {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function shouldStartNewSession(prev: TracksRow, curr: TracksRow, gapMs: number): boolean {
  if (gapMs > 30000) return true
  if (curr.app !== prev.app) return true
  if (curr.url !== prev.url) return true
  if (curr.window_title !== prev.window_title) return true
  if (curr.activity_type !== prev.activity_type) return true
  return false
}

class TracksImportService {
  private watchController: AbortController | null = null

  async importDay(dateStr: string): Promise<ImportResult> {
    const filePath = path.join(env.TRACKS_RAW_DIR, `${dateStr}.ndjson`)
    return this.importFile(filePath)
  }

  async importFile(filePath: string): Promise<ImportResult> {
    const fileName = path.basename(filePath)
    const dateMatch = fileName.match(/^(\d{4}-\d{2}-\d{2})\.ndjson$/)
    if (!dateMatch) {
      throw new Error(`Invalid file name format: ${fileName}`)
    }
    const fileDate = dateMatch[1]

    const existingImport = await db
      .selectFrom('tracks_import')
      .select(['last_row_ts'])
      .where('file_date', '=', new Date(fileDate))
      .executeTakeFirst()

    const lastRowTs = existingImport?.last_row_ts

    const rows = await this.readNdjsonFile(filePath, lastRowTs)
    if (rows.length === 0) {
      return { file: fileName, rowsImported: 0, sessionsCreated: 0, urlsLinked: 0 }
    }

    const sessions = this.buildSessions(rows, new Date(fileDate))
    let urlsLinked = 0

    for (const session of sessions) {
      let urlId: number | null = null

      if (session.url) {
        const normalized = normalizeUrl(session.url)
        if (normalized) {
          const existingUrl = await db
            .selectFrom('url')
            .select('url_id')
            .where('url_norm', '=', normalized.url_norm)
            .executeTakeFirst()

          if (existingUrl) {
            urlId = existingUrl.url_id
            urlsLinked++
          } else {
            const inserted = await db
              .insertInto('url')
              .values({
                url_norm: normalized.url_norm,
                domain: normalized.domain,
                path: normalized.path,
              })
              .returning('url_id')
              .executeTakeFirst()
            urlId = inserted?.url_id ?? null
          }
        }
      }

      const docId = urlId ? await this.findDocumentForUrl(urlId) : null

      await db
        .insertInto('activity_session')
        .values({
          start_at: session.start_at,
          end_at: session.end_at,
          app: session.app,
          window_title: session.window_title,
          url_id: urlId,
          site: session.site,
          activity_type: session.activity_type,
          doc_id: docId,
          source_date: new Date(fileDate),
        })
        .execute()
    }

    const lastTs = rows[rows.length - 1].ts

    await db
      .insertInto('tracks_import')
      .values({
        source_file: fileName,
        file_date: new Date(fileDate),
        rows_imported: rows.length,
        sessions_created: sessions.length,
        last_row_ts: new Date(lastTs),
      })
      .onConflict((oc) =>
        oc.column('file_date').doUpdateSet({
          rows_imported: sql`COALESCE(tracks_import.rows_imported, 0) + ${rows.length}`,
          sessions_created: sql`COALESCE(tracks_import.sessions_created, 0) + ${sessions.length}`,
          last_row_ts: new Date(lastTs),
          imported_at: new Date(),
        }),
      )
      .execute()

    return {
      file: fileName,
      rowsImported: rows.length,
      sessionsCreated: sessions.length,
      urlsLinked,
    }
  }

  private async readNdjsonFile(
    filePath: string,
    afterTs?: Date | null,
  ): Promise<TracksRow[]> {
    if (!fs.existsSync(filePath)) {
      return []
    }

    const rows: TracksRow[] = []
    const fileStream = fs.createReadStream(filePath)
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity })

    for await (const line of rl) {
      if (!line.trim()) continue
      try {
        const row = JSON.parse(line) as TracksRow
        if (afterTs && new Date(row.ts) <= afterTs) continue
        rows.push(row)
      } catch {
        // Skip malformed lines
      }
    }

    return rows.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
  }

  private buildSessions(rows: TracksRow[], _sourceDate: Date): SessionBuilder[] {
    if (rows.length === 0) return []

    const sessions: SessionBuilder[] = []
    let current: SessionBuilder | null = null

    for (const row of rows) {
      const rowTs = new Date(row.ts)

      if (!current) {
        current = {
          start_at: rowTs,
          end_at: rowTs,
          app: row.app,
          window_title: row.window_title,
          url: row.url,
          site: extractSite(row.url),
          activity_type: row.activity_type,
        }
        continue
      }

      const gapMs = rowTs.getTime() - current.end_at.getTime()

      if (
        shouldStartNewSession(
          { ...row, ts: current.end_at.toISOString() } as TracksRow,
          row,
          gapMs,
        )
      ) {
        sessions.push(current)
        current = {
          start_at: rowTs,
          end_at: rowTs,
          app: row.app,
          window_title: row.window_title,
          url: row.url,
          site: extractSite(row.url),
          activity_type: row.activity_type,
        }
      } else {
        current.end_at = rowTs
      }
    }

    if (current) {
      sessions.push(current)
    }

    return sessions
  }

  private async findDocumentForUrl(urlId: number): Promise<number | null> {
    const doc = await db
      .selectFrom('document')
      .select('doc_id')
      .where('url_id', '=', urlId)
      .executeTakeFirst()
    return doc?.doc_id ?? null
  }

  async syncAllFiles(): Promise<ImportResult[]> {
    const files = fs
      .readdirSync(env.TRACKS_RAW_DIR)
      .filter((f) => f.endsWith('.ndjson'))
      .sort()

    const results: ImportResult[] = []
    for (const file of files) {
      const result = await this.importFile(path.join(env.TRACKS_RAW_DIR, file))
      results.push(result)
    }
    return results
  }

  startWatcher(): void {
    if (this.watchController) {
      this.watchController.abort()
    }

    this.watchController = new AbortController()
    const { signal } = this.watchController

    const watcher = fs.watch(
      env.TRACKS_RAW_DIR,
      { signal },
      async (eventType, filename) => {
        if (!filename || !filename.endsWith('.ndjson')) return

        try {
          const filePath = path.join(env.TRACKS_RAW_DIR, filename)
          await this.importFile(filePath)
        } catch (err) {
          console.error(`Error importing ${filename}:`, err)
        }
      },
    )

    watcher.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code !== 'ABORT_ERR') {
        console.error('File watcher error:', err)
      }
    })

    console.log(`Watching ${env.TRACKS_RAW_DIR} for changes...`)
  }

  stopWatcher(): void {
    if (this.watchController) {
      this.watchController.abort()
      this.watchController = null
    }
  }

  async linkSessionsToDocuments(): Promise<number> {
    const result = await db
      .updateTable('activity_session')
      .set((eb) => ({
        doc_id: eb
          .selectFrom('document')
          .select('doc_id')
          .whereRef('document.url_id', '=', 'activity_session.url_id')
          .limit(1),
      }))
      .where('doc_id', 'is', null)
      .where('url_id', 'is not', null)
      .executeTakeFirst()

    return Number(result.numUpdatedRows)
  }
}

export const tracksImportService = new TracksImportService()
