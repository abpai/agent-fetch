import { sql } from 'kysely'

import { db } from '../db/index.js'
import { embeddingService } from './embedding.service.js'
import type { SearchLog, NewSearchLog, SearchMode } from '../db/schema.js'

export interface LogSearchParams {
  query: string
  mode: SearchMode
  resultsCount: number
  timeRangeStart?: Date
  timeRangeEnd?: Date
  domains?: string[]
  topResultDocId?: number
  clickedDocIds?: number[]
  sessionId?: number
}

class SearchLogService {
  /**
   * Log a search query for pattern detection.
   */
  async logSearch(params: LogSearchParams): Promise<SearchLog> {
    let embedding: number[] | null = null
    try {
      embedding = await embeddingService.embedQuery(params.query)
    } catch (e) {
      console.warn('Failed to generate search embedding:', e)
    }

    const log: NewSearchLog = {
      query_text: params.query,
      query_embedding: embedding,
      search_mode: params.mode,
      results_count: params.resultsCount,
      time_range_start: params.timeRangeStart || null,
      time_range_end: params.timeRangeEnd || null,
      domains: params.domains || null,
      top_result_doc_id: params.topResultDocId || null,
      clicked_doc_ids: params.clickedDocIds || [],
      session_id: params.sessionId || null,
    }

    // Use raw SQL to handle the vector type
    const result = await sql<SearchLog>`
      INSERT INTO search_log (
        query_text, query_embedding, search_mode,
        time_range_start, time_range_end, domains,
        results_count, clicked_doc_ids, top_result_doc_id, session_id
      ) VALUES (
        ${log.query_text},
        ${log.query_embedding ? sql`${JSON.stringify(log.query_embedding)}::vector` : null},
        ${log.search_mode},
        ${log.time_range_start},
        ${log.time_range_end},
        ${log.domains ? sql`${log.domains}::text[]` : null},
        ${log.results_count},
        ${sql`${log.clicked_doc_ids}::integer[]`},
        ${log.top_result_doc_id},
        ${log.session_id}
      )
      RETURNING *
    `.execute(db)

    return result.rows[0]
  }

  /**
   * Record a click on a search result.
   */
  async recordClick(searchId: number, docId: number): Promise<void> {
    await sql`
      UPDATE search_log
      SET clicked_doc_ids = array_append(clicked_doc_ids, ${docId})
      WHERE search_id = ${searchId}
    `.execute(db)
  }

  /**
   * Get recent searches.
   */
  async getRecentSearches(limit = 20): Promise<SearchLog[]> {
    return db
      .selectFrom('search_log')
      .selectAll()
      .orderBy('searched_at', 'desc')
      .limit(limit)
      .execute()
  }

  /**
   * Find similar past searches using embedding similarity.
   */
  async findSimilarSearches(
    query: string,
    minSimilarity = 0.8,
    limit = 10,
  ): Promise<Array<SearchLog & { similarity: number }>> {
    const embedding = await embeddingService.embedQuery(query)

    const results = await sql<SearchLog & { similarity: number }>`
      SELECT
        *,
        1 - (query_embedding <=> ${JSON.stringify(embedding)}::vector) as similarity
      FROM search_log
      WHERE query_embedding IS NOT NULL
        AND 1 - (query_embedding <=> ${JSON.stringify(embedding)}::vector) >= ${minSimilarity}
      ORDER BY similarity DESC
      LIMIT ${limit}
    `.execute(db)

    return results.rows
  }

  /**
   * Get search frequency by day.
   */
  async getSearchFrequency(days = 30): Promise<{ date: string; count: number }[]> {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)

    const results = await sql<{ date: string; count: string }>`
      SELECT
        DATE(searched_at)::text as date,
        COUNT(*)::text as count
      FROM search_log
      WHERE searched_at >= ${cutoff}
      GROUP BY DATE(searched_at)
      ORDER BY date DESC
    `.execute(db)

    return results.rows.map((r) => ({
      date: r.date,
      count: Number(r.count),
    }))
  }

  /**
   * Get a single search by ID.
   */
  async getSearch(searchId: number): Promise<SearchLog | undefined> {
    return db
      .selectFrom('search_log')
      .selectAll()
      .where('search_id', '=', searchId)
      .executeTakeFirst()
  }
}

export const searchLogService = new SearchLogService()
