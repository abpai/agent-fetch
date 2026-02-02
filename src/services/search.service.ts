import { sql } from 'kysely'

import { db } from '../db/index.js'

import { embeddingService } from './embedding.service.js'
import { searchLogService } from './search-log.service.js'

export interface SearchParams {
  query: string
  mode: 'semantic' | 'keyword' | 'hybrid'
  timeRange?: { start: string; end: string }
  domains?: string[]
  limit?: number
}

export interface SearchResult {
  chunk_id: number
  doc_id: number
  title: string | null
  url: string
  heading: string | null
  snippet: string
  score: number
  visited_at: string[]
  citation: string
}

export interface DocumentResult {
  doc_id: number
  url: string
  title: string | null
  author: string | null
  fetched_at: string
  visits: { visited_at: string }[]
  chunks?: ChunkResult[]
}

export interface ChunkResult {
  chunk_id: number
  chunk_index: number
  heading: string | null
  text: string
  token_count: number | null
}

export interface WeeklyRecap {
  week_start: string
  week_end: string
  total_visits: number
  unique_docs: number
  themes: {
    name: string
    doc_ids: number[]
    top_chunks: { chunk_id: number; snippet: string }[]
  }[]
  notable_docs: {
    doc_id: number
    title: string | null
    url: string
    visit_count: number
  }[]
}

class SearchService {
  /**
   * Search memory using semantic, keyword, or hybrid mode
   */
  async search(params: SearchParams): Promise<SearchResult[]> {
    const limit = params.limit || 10
    let results: SearchResult[]

    if (params.mode === 'keyword') {
      results = await this.keywordSearch(
        params.query,
        limit,
        params.domains,
        params.timeRange,
      )
    } else if (params.mode === 'semantic') {
      results = await this.semanticSearch(
        params.query,
        limit,
        params.domains,
        params.timeRange,
      )
    } else {
      // Hybrid: run both and merge results
      const [keywordResults, semanticResults] = await Promise.all([
        this.keywordSearch(params.query, limit, params.domains, params.timeRange),
        this.semanticSearch(params.query, limit, params.domains, params.timeRange),
      ])

      // Merge and dedupe by chunk_id, boosting items that appear in both
      const seen = new Map<number, SearchResult>()

      for (const result of semanticResults) {
        seen.set(result.chunk_id, result)
      }

      for (const result of keywordResults) {
        const existing = seen.get(result.chunk_id)
        if (existing) {
          // Boost score for items in both result sets
          existing.score = (existing.score + result.score) / 2 + 0.1
        } else {
          seen.set(result.chunk_id, result)
        }
      }

      // Sort by score and return top results
      results = Array.from(seen.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
    }

    // Log search for pattern detection (fire-and-forget, non-blocking)
    // Intentionally swallows errors - search logging is non-critical and should not block results
    searchLogService
      .logSearch({
        query: params.query,
        mode: params.mode,
        resultsCount: results.length,
        timeRangeStart: params.timeRange?.start
          ? new Date(params.timeRange.start)
          : undefined,
        timeRangeEnd: params.timeRange?.end ? new Date(params.timeRange.end) : undefined,
        domains: params.domains,
        topResultDocId: results[0]?.doc_id,
      })
      .catch((err) => {
        console.warn('Failed to log search:', err)
      })

    return results
  }

  private async keywordSearch(
    query: string,
    limit: number,
    domains?: string[],
    timeRange?: { start: string; end: string },
  ): Promise<SearchResult[]> {
    // Use PostgreSQL full-text search on chunk text
    const tsQuery = query
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .map((w) => w + ':*')
      .join(' & ')

    if (!tsQuery) return []

    let baseQuery = sql`
      SELECT
        c.chunk_id,
        c.doc_id,
        c.text,
        c.heading,
        d.title,
        u.url_norm as url,
        ts_rank(to_tsvector('english', c.text), to_tsquery('english', ${tsQuery})) as score,
        ARRAY_AGG(DISTINCT v.visited_at ORDER BY v.visited_at DESC) as visited_at
      FROM chunk c
      JOIN document d ON c.doc_id = d.doc_id
      JOIN url u ON d.url_id = u.url_id
      LEFT JOIN visit v ON u.url_id = v.url_id
      WHERE to_tsvector('english', c.text) @@ to_tsquery('english', ${tsQuery})
    `

    if (domains && domains.length > 0) {
      baseQuery = sql`${baseQuery} AND u.domain = ANY(${domains})`
    }

    if (timeRange?.start) {
      baseQuery = sql`${baseQuery} AND v.visited_at >= ${new Date(timeRange.start)}`
    }

    if (timeRange?.end) {
      baseQuery = sql`${baseQuery} AND v.visited_at <= ${new Date(timeRange.end)}`
    }

    baseQuery = sql`
      ${baseQuery}
      GROUP BY c.chunk_id, c.doc_id, c.text, c.heading, d.title, u.url_norm
      ORDER BY score DESC
      LIMIT ${limit}
    `

    const result = await baseQuery.execute(db)

    return (result.rows as Array<Record<string, unknown>>).map((row) => ({
      chunk_id: row.chunk_id as number,
      doc_id: row.doc_id as number,
      title: row.title as string | null,
      url: row.url as string,
      heading: row.heading as string | null,
      snippet: this.truncate(row.text as string, 200),
      score: row.score as number,
      visited_at: ((row.visited_at as Date[]) || []).map((d) => d?.toISOString?.() || ''),
      citation: `doc:${row.doc_id}/chunk:${row.chunk_id}`,
    }))
  }

  private async semanticSearch(
    query: string,
    limit: number,
    domains?: string[],
    timeRange?: { start: string; end: string },
  ): Promise<SearchResult[]> {
    const queryEmbedding = await embeddingService.embedQuery(query)

    const filters: {
      domains?: string[]
      startDate?: Date
      endDate?: Date
    } = {}

    if (domains) filters.domains = domains
    if (timeRange?.start) filters.startDate = new Date(timeRange.start)
    if (timeRange?.end) filters.endDate = new Date(timeRange.end)

    const results = await embeddingService.searchSimilar(queryEmbedding, limit, filters)

    return results.map((row) => ({
      chunk_id: row.chunk_id,
      doc_id: row.doc_id,
      title: row.title,
      url: row.url,
      heading: row.heading,
      snippet: this.truncate(row.text, 200),
      score: row.score,
      visited_at: (row.visited_at || []).map((d) => d?.toISOString?.() || ''),
      citation: `doc:${row.doc_id}/chunk:${row.chunk_id}`,
    }))
  }

  /**
   * Get a document by ID with optional chunks
   */
  async getDocument(
    docId: number,
    includeChunks: boolean = false,
    chunkRange?: { start: number; end: number },
  ): Promise<DocumentResult | null> {
    const doc = await db
      .selectFrom('document')
      .innerJoin('url', 'document.url_id', 'url.url_id')
      .select([
        'document.doc_id',
        'url.url_norm as url',
        'document.title',
        'document.author',
        'document.fetched_at',
      ])
      .where('document.doc_id', '=', docId)
      .executeTakeFirst()

    if (!doc) return null

    // Get visits for this document
    const visits = await db
      .selectFrom('visit')
      .innerJoin('document', (join) =>
        join.on((eb) =>
          eb.and([
            eb('visit.url_id', '=', eb.ref('document.url_id')),
            eb('document.doc_id', '=', docId),
          ]),
        ),
      )
      .select('visit.visited_at')
      .orderBy('visit.visited_at', 'desc')
      .execute()

    const result: DocumentResult = {
      doc_id: doc.doc_id,
      url: doc.url,
      title: doc.title,
      author: doc.author,
      fetched_at: doc.fetched_at.toISOString(),
      visits: visits.map((v) => ({ visited_at: v.visited_at.toISOString() })),
    }

    if (includeChunks) {
      let chunkQuery = db
        .selectFrom('chunk')
        .select(['chunk_id', 'chunk_index', 'heading', 'text', 'token_count'])
        .where('doc_id', '=', docId)
        .orderBy('chunk_index')

      if (chunkRange) {
        chunkQuery = chunkQuery
          .where('chunk_index', '>=', chunkRange.start)
          .where('chunk_index', '<=', chunkRange.end)
      }

      result.chunks = await chunkQuery.execute()
    }

    return result
  }

  /**
   * Generate a weekly recap for the given week
   */
  async getWeeklyRecap(weekOf: string): Promise<WeeklyRecap> {
    const date = new Date(weekOf)
    const dayOfWeek = date.getDay()
    const weekStart = new Date(date)
    weekStart.setDate(date.getDate() - dayOfWeek)
    weekStart.setHours(0, 0, 0, 0)

    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekStart.getDate() + 7)
    weekEnd.setHours(0, 0, 0, 0)

    // Get visit stats for the week
    const visitStats = await sql`
      SELECT
        COUNT(DISTINCT v.visit_id) as total_visits,
        COUNT(DISTINCT d.doc_id) as unique_docs
      FROM visit v
      JOIN url u ON v.url_id = u.url_id
      LEFT JOIN document d ON u.url_id = d.url_id
      WHERE v.visited_at >= ${weekStart} AND v.visited_at < ${weekEnd}
    `.execute(db)

    const stats = (visitStats.rows[0] as {
      total_visits: string
      unique_docs: string
    }) || {
      total_visits: '0',
      unique_docs: '0',
    }

    // Get notable docs (most visited in the week)
    const notableDocs = await sql`
      SELECT
        d.doc_id,
        d.title,
        u.url_norm as url,
        COUNT(v.visit_id) as visit_count
      FROM visit v
      JOIN url u ON v.url_id = u.url_id
      JOIN document d ON u.url_id = d.url_id
      WHERE v.visited_at >= ${weekStart} AND v.visited_at < ${weekEnd}
      GROUP BY d.doc_id, d.title, u.url_norm
      ORDER BY visit_count DESC
      LIMIT 10
    `.execute(db)

    return {
      week_start: weekStart.toISOString(),
      week_end: weekEnd.toISOString(),
      total_visits: parseInt(stats.total_visits) || 0,
      unique_docs: parseInt(stats.unique_docs) || 0,
      themes: [], // TODO: implement clustering
      notable_docs: (notableDocs.rows as Array<Record<string, unknown>>).map((row) => ({
        doc_id: row.doc_id as number,
        title: row.title as string | null,
        url: row.url as string,
        visit_count: parseInt(row.visit_count as string) || 0,
      })),
    }
  }

  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text
    return text.slice(0, maxLength - 3) + '...'
  }
}

export const searchService = new SearchService()
