import { sql } from 'kysely'

import { db } from '../db/index.js'
import type { InsightType, InsightStatus, Insight } from '../db/schema.js'

export interface DetectedPattern {
  type: InsightType
  title: string
  description: string
  suggestion: string
  confidence: number
  priority: number
  doc_ids?: number[]
  url_ids?: number[]
  tag_ids?: number[]
  session_ids?: number[]
  search_log_ids?: number[]
  metadata?: Record<string, unknown>
  expires_at?: Date
}

export interface OpenLoopCandidate {
  doc_id: number
  url: string
  title: string | null
  visit_count: number
  last_visited: Date
  days_since_visit: number
  time_spent_seconds: number
}

export interface RepeatedSearchCluster {
  queries: string[]
  search_ids: number[]
  avg_results: number
  first_searched: Date
  last_searched: Date
  span_days: number
}

export interface StaleTopicCandidate {
  tag_id: number
  tag_name: string
  doc_count: number
  avg_score: number
  last_activity: Date
  days_stale: number
  top_doc_ids: number[]
}

export interface ContextSwitchPattern {
  window_start: Date
  window_end: Date
  app_count: number
  switch_count: number
  apps: string[]
  avg_session_seconds: number
}

export interface PatternServiceConfig {
  openLoopDays: number
  openLoopMaxVisits: number
  repeatedSearchDays: number
  repeatedSearchSimilarity: number
  staleTopicDays: number
  staleTopicMinScore: number
  contextSwitchWindowMinutes: number
  contextSwitchMinApps: number
  insightCacheDays: number
}

const DEFAULT_CONFIG: PatternServiceConfig = {
  openLoopDays: 7,
  openLoopMaxVisits: 2,
  repeatedSearchDays: 30,
  repeatedSearchSimilarity: 0.85,
  staleTopicDays: 14,
  staleTopicMinScore: 0.7,
  contextSwitchWindowMinutes: 15,
  contextSwitchMinApps: 5,
  insightCacheDays: 1,
}

class PatternService {
  private config: PatternServiceConfig

  constructor(config: Partial<PatternServiceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Detect open loops: documents visited 1-2 times, older than N days,
   * not appearing in recent activity.
   */
  async detectOpenLoops(
    options: { minDaysOld?: number } = {},
  ): Promise<DetectedPattern[]> {
    const daysOld = options.minDaysOld ?? this.config.openLoopDays
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysOld)

    const recentActivityCutoff = new Date()
    recentActivityCutoff.setDate(recentActivityCutoff.getDate() - 3)

    const results = await sql<OpenLoopCandidate>`
      WITH doc_visits AS (
        SELECT
          d.doc_id,
          u.url_norm as url,
          d.title,
          COUNT(v.visit_id) as visit_count,
          MAX(v.visited_at) as last_visited
        FROM document d
        JOIN url u ON d.url_id = u.url_id
        LEFT JOIN visit v ON u.url_id = v.url_id
        WHERE d.status = 'ok'
        GROUP BY d.doc_id, u.url_norm, d.title
        HAVING COUNT(v.visit_id) <= ${this.config.openLoopMaxVisits}
          AND MAX(v.visited_at) < ${cutoffDate}
      ),
      recent_activity AS (
        SELECT DISTINCT doc_id
        FROM activity_session
        WHERE doc_id IS NOT NULL
          AND end_at > ${recentActivityCutoff}
      ),
      time_spent AS (
        SELECT
          doc_id,
          SUM(duration_seconds) as time_spent_seconds
        FROM activity_session
        WHERE doc_id IS NOT NULL
        GROUP BY doc_id
      )
      SELECT
        dv.doc_id,
        dv.url,
        dv.title,
        dv.visit_count::integer,
        dv.last_visited,
        EXTRACT(DAY FROM NOW() - dv.last_visited)::integer as days_since_visit,
        COALESCE(ts.time_spent_seconds, 0)::integer as time_spent_seconds
      FROM doc_visits dv
      LEFT JOIN recent_activity ra ON dv.doc_id = ra.doc_id
      LEFT JOIN time_spent ts ON dv.doc_id = ts.doc_id
      WHERE ra.doc_id IS NULL
      ORDER BY dv.last_visited DESC
      LIMIT 20
    `.execute(db)

    return results.rows.map((c) => ({
      type: 'open_loop' as InsightType,
      title: `Unfinished: ${c.title || c.url}`,
      description:
        `Visited ${c.visit_count} time(s), ${c.days_since_visit} days ago. ` +
        `Spent ${Math.round(c.time_spent_seconds / 60)} minutes total.`,
      suggestion: `Consider revisiting or bookmarking for later reference.`,
      confidence: this.calculateOpenLoopConfidence(c),
      priority: this.calculateOpenLoopPriority(c),
      doc_ids: [c.doc_id],
      metadata: {
        visit_count: c.visit_count,
        days_since_visit: c.days_since_visit,
        time_spent_seconds: c.time_spent_seconds,
        url: c.url,
      },
      expires_at: this.getExpirationDate(),
    }))
  }

  /**
   * Detect repeated searches: similar queries within N days.
   */
  async detectRepeatedSearches(): Promise<DetectedPattern[]> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - this.config.repeatedSearchDays)

    // Get recent searches
    const recentSearches = await db
      .selectFrom('search_log')
      .select([
        'search_id',
        'query_text',
        'query_embedding',
        'results_count',
        'searched_at',
      ])
      .where('searched_at', '>', cutoffDate)
      .where('query_embedding', 'is not', null)
      .orderBy('searched_at', 'desc')
      .limit(200)
      .execute()

    if (recentSearches.length < 2) return []

    // Cluster similar searches
    const clusters: RepeatedSearchCluster[] = []
    const used = new Set<number>()

    for (const search of recentSearches) {
      if (used.has(search.search_id)) continue
      if (!search.query_embedding) continue

      // Find similar searches
      const similar = await sql<{ search_id: number; similarity: number }>`
        SELECT
          search_id,
          1 - (query_embedding <=> ${JSON.stringify(search.query_embedding)}::vector) as similarity
        FROM search_log
        WHERE search_id != ${search.search_id}
          AND searched_at > ${cutoffDate}
          AND query_embedding IS NOT NULL
          AND 1 - (query_embedding <=> ${JSON.stringify(search.query_embedding)}::vector) > ${this.config.repeatedSearchSimilarity}
        ORDER BY similarity DESC
        LIMIT 10
      `.execute(db)

      const clusterIds = [search.search_id, ...similar.rows.map((r) => r.search_id)]

      if (clusterIds.length >= 2) {
        clusterIds.forEach((id) => used.add(id))

        const clusterSearches = recentSearches.filter((s) =>
          clusterIds.includes(s.search_id),
        )
        const dates = clusterSearches.map((s) => s.searched_at)

        clusters.push({
          queries: [...new Set(clusterSearches.map((s) => s.query_text))],
          search_ids: clusterIds,
          avg_results:
            clusterSearches.reduce((sum, s) => sum + s.results_count, 0) /
            clusterSearches.length,
          first_searched: new Date(Math.min(...dates.map((d) => d.getTime()))),
          last_searched: new Date(Math.max(...dates.map((d) => d.getTime()))),
          span_days:
            (Math.max(...dates.map((d) => d.getTime())) -
              Math.min(...dates.map((d) => d.getTime()))) /
            (1000 * 60 * 60 * 24),
        })
      }
    }

    return clusters
      .filter((c) => c.search_ids.length >= 3 || c.span_days >= 3)
      .map((c) => ({
        type: 'repeated_search' as InsightType,
        title: `Recurring search: "${c.queries[0]}"`,
        description:
          `Searched ${c.search_ids.length} times over ${Math.round(c.span_days)} days. ` +
          `Average ${Math.round(c.avg_results)} results.`,
        suggestion:
          `This topic seems important. Consider creating a saved search or ` +
          `investigating why results aren't satisfying.`,
        confidence: Math.min(0.9, 0.5 + c.search_ids.length * 0.1),
        priority: Math.max(3, 8 - c.search_ids.length),
        search_log_ids: c.search_ids,
        metadata: {
          queries: c.queries,
          search_count: c.search_ids.length,
          span_days: c.span_days,
          avg_results: c.avg_results,
        },
        expires_at: this.getExpirationDate(),
      }))
  }

  /**
   * Detect stale expertise: high tag-score documents not touched in N+ days.
   */
  async detectStaleExpertise(): Promise<DetectedPattern[]> {
    const staleCutoff = new Date()
    staleCutoff.setDate(staleCutoff.getDate() - this.config.staleTopicDays)

    const results = await sql<StaleTopicCandidate>`
      WITH tag_activity AS (
        SELECT
          t.tag_id,
          t.name as tag_name,
          COUNT(DISTINCT dt.doc_id) as doc_count,
          AVG(dt.score) as avg_score,
          MAX(COALESCE(s.end_at, v.visited_at)) as last_activity,
          ARRAY_AGG(DISTINCT dt.doc_id ORDER BY dt.score DESC) as doc_ids
        FROM tag t
        JOIN doc_tag dt ON t.tag_id = dt.tag_id
        JOIN document d ON dt.doc_id = d.doc_id
        LEFT JOIN activity_session s ON d.doc_id = s.doc_id
        LEFT JOIN visit v ON d.url_id = v.url_id
        WHERE dt.score >= ${this.config.staleTopicMinScore}
        GROUP BY t.tag_id, t.name
        HAVING COUNT(DISTINCT dt.doc_id) >= 3
          AND MAX(COALESCE(s.end_at, v.visited_at)) < ${staleCutoff}
      )
      SELECT
        tag_id,
        tag_name,
        doc_count::integer,
        avg_score::real,
        last_activity,
        EXTRACT(DAY FROM NOW() - last_activity)::integer as days_stale,
        doc_ids[1:5] as top_doc_ids
      FROM tag_activity
      ORDER BY avg_score DESC, doc_count DESC
      LIMIT 10
    `.execute(db)

    return results.rows.map((c) => ({
      type: 'stale_topic' as InsightType,
      title: `Neglected expertise: ${c.tag_name}`,
      description:
        `${c.doc_count} documents with avg score ${c.avg_score.toFixed(2)}. ` +
        `Last activity ${c.days_stale} days ago.`,
      suggestion:
        `You were deeply engaged with this topic. ` +
        `Consider reviewing recent developments or archiving if no longer relevant.`,
      confidence: Math.min(0.9, c.avg_score),
      priority: Math.max(4, Math.round(10 - c.avg_score * 5)),
      tag_ids: [c.tag_id],
      doc_ids: c.top_doc_ids,
      metadata: {
        doc_count: c.doc_count,
        avg_score: c.avg_score,
        days_stale: c.days_stale,
      },
      expires_at: this.getExpirationDate(),
    }))
  }

  /**
   * Detect context switches: frequent app changes within short windows.
   */
  async detectContextSwitches(): Promise<DetectedPattern[]> {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const windowMs = this.config.contextSwitchWindowMinutes * 60 * 1000

    const sessions = await db
      .selectFrom('activity_session')
      .select(['session_id', 'app', 'start_at', 'end_at', 'duration_seconds'])
      .where('source_date', '=', today)
      .where('activity_type', '=', 'active')
      .orderBy('start_at')
      .execute()

    if (sessions.length < 5) return []

    const patterns: ContextSwitchPattern[] = []

    for (let i = 0; i < sessions.length; i++) {
      const windowStart = sessions[i].start_at
      const windowEnd = new Date(windowStart.getTime() + windowMs)

      const windowSessions = sessions.filter(
        (s) => s.start_at >= windowStart && s.start_at < windowEnd,
      )

      const uniqueApps = [...new Set(windowSessions.map((s) => s.app))]

      if (uniqueApps.length >= this.config.contextSwitchMinApps) {
        const overlaps = patterns.some(
          (p) =>
            Math.abs(p.window_start.getTime() - windowStart.getTime()) < windowMs / 2,
        )

        if (!overlaps) {
          patterns.push({
            window_start: windowStart,
            window_end: windowEnd,
            app_count: uniqueApps.length,
            switch_count: windowSessions.length - 1,
            apps: uniqueApps,
            avg_session_seconds:
              windowSessions.reduce((sum, s) => sum + s.duration_seconds, 0) /
              windowSessions.length,
          })
        }
      }
    }

    return patterns.slice(0, 5).map((p) => ({
      type: 'context_switch' as InsightType,
      title: `Fragmented focus at ${p.window_start.toLocaleTimeString()}`,
      description:
        `Switched between ${p.app_count} apps ${p.switch_count} times in ` +
        `${this.config.contextSwitchWindowMinutes} minutes. ` +
        `Average session: ${Math.round(p.avg_session_seconds)}s.`,
      suggestion: `Consider blocking focused time or identifying the cause of context switching.`,
      confidence: Math.min(0.9, 0.5 + p.switch_count * 0.05),
      priority: p.switch_count > 10 ? 3 : 5,
      session_ids: [],
      metadata: {
        apps: p.apps,
        switch_count: p.switch_count,
        avg_session_seconds: p.avg_session_seconds,
        window_minutes: this.config.contextSwitchWindowMinutes,
      },
      expires_at: this.getExpirationDate(0.5),
    }))
  }

  /**
   * Run all pattern detectors and update the insight table.
   */
  async refreshInsights(): Promise<{
    detected: number
    created: number
    updated: number
    expired: number
  }> {
    // Expire old insights
    const expiredResult = await db
      .updateTable('insight')
      .set({ status: 'resolved', resolved_at: new Date() })
      .where('expires_at', '<', new Date())
      .where('status', 'in', ['new', 'acknowledged'])
      .execute()

    // Run all detectors
    const [openLoops, repeatedSearches, staleTopics, contextSwitches] = await Promise.all(
      [
        this.detectOpenLoops(),
        this.detectRepeatedSearches(),
        this.detectStaleExpertise(),
        this.detectContextSwitches(),
      ],
    )

    const allPatterns = [
      ...openLoops,
      ...repeatedSearches,
      ...staleTopics,
      ...contextSwitches,
    ]

    let created = 0
    let updated = 0

    for (const pattern of allPatterns) {
      const existing = await this.findSimilarInsight(pattern)

      if (existing) {
        await db
          .updateTable('insight')
          .set({
            confidence: pattern.confidence,
            priority: pattern.priority,
            description: pattern.description,
            suggestion: pattern.suggestion,
            expires_at: pattern.expires_at,
            metadata: pattern.metadata as Record<string, unknown>,
          })
          .where('insight_id', '=', existing.insight_id)
          .execute()
        updated++
      } else {
        await db
          .insertInto('insight')
          .values({
            type: pattern.type,
            status: 'new',
            title: pattern.title,
            description: pattern.description,
            suggestion: pattern.suggestion,
            confidence: pattern.confidence,
            priority: pattern.priority,
            doc_ids: pattern.doc_ids || [],
            url_ids: pattern.url_ids || [],
            tag_ids: pattern.tag_ids || [],
            chunk_ids: [],
            session_ids: pattern.session_ids || [],
            search_log_ids: pattern.search_log_ids || [],
            metadata: pattern.metadata || {},
            expires_at: pattern.expires_at,
          })
          .execute()
        created++
      }
    }

    return {
      detected: allPatterns.length,
      created,
      updated,
      expired: Number(expiredResult[0].numUpdatedRows),
    }
  }

  /**
   * Get active (non-expired, non-resolved) insights.
   */
  async getActiveInsights(
    options: {
      types?: InsightType[]
      status?: InsightStatus[]
      limit?: number
      minConfidence?: number
    } = {},
  ): Promise<Insight[]> {
    let query = db
      .selectFrom('insight')
      .selectAll()
      .where('status', 'in', options.status || ['new', 'acknowledged'])
      .orderBy('priority', 'asc')
      .orderBy('detected_at', 'desc')

    if (options.types && options.types.length > 0) {
      query = query.where('type', 'in', options.types)
    }

    if (options.minConfidence) {
      query = query.where('confidence', '>=', options.minConfidence)
    }

    if (options.limit) {
      query = query.limit(options.limit)
    }

    return query.execute()
  }

  /**
   * Acknowledge an insight (user has seen it).
   */
  async acknowledgeInsight(insightId: number): Promise<void> {
    await db
      .updateTable('insight')
      .set({ status: 'acknowledged', acknowledged_at: new Date() })
      .where('insight_id', '=', insightId)
      .execute()
  }

  /**
   * Dismiss an insight (user doesn't want to see it).
   */
  async dismissInsight(insightId: number): Promise<void> {
    await db
      .updateTable('insight')
      .set({ status: 'dismissed' })
      .where('insight_id', '=', insightId)
      .execute()
  }

  /**
   * Resolve an insight (pattern addressed).
   */
  async resolveInsight(insightId: number): Promise<void> {
    await db
      .updateTable('insight')
      .set({ status: 'resolved', resolved_at: new Date() })
      .where('insight_id', '=', insightId)
      .execute()
  }

  /**
   * Get a single insight by ID.
   */
  async getInsight(insightId: number): Promise<Insight | undefined> {
    return db
      .selectFrom('insight')
      .selectAll()
      .where('insight_id', '=', insightId)
      .executeTakeFirst()
  }

  private calculateOpenLoopConfidence(c: OpenLoopCandidate): number {
    const visitFactor = 1 - c.visit_count / (this.config.openLoopMaxVisits + 1)
    const ageFactor = Math.min(1, c.days_since_visit / 30)
    const engagementFactor = Math.min(1, c.time_spent_seconds / 600)

    return (
      Math.round((visitFactor * 0.3 + ageFactor * 0.3 + engagementFactor * 0.4) * 100) /
      100
    )
  }

  private calculateOpenLoopPriority(c: OpenLoopCandidate): number {
    if (c.time_spent_seconds > 300 && c.days_since_visit < 14) return 3
    if (c.time_spent_seconds > 60) return 5
    return 7
  }

  private async findSimilarInsight(
    pattern: DetectedPattern,
  ): Promise<Insight | undefined> {
    let query = db
      .selectFrom('insight')
      .selectAll()
      .where('type', '=', pattern.type)
      .where('status', 'in', ['new', 'acknowledged'])

    if (pattern.doc_ids && pattern.doc_ids.length > 0) {
      query = query.where('doc_ids', '@>', pattern.doc_ids)
    } else if (pattern.tag_ids && pattern.tag_ids.length > 0) {
      query = query.where('tag_ids', '@>', pattern.tag_ids)
    } else if (pattern.search_log_ids && pattern.search_log_ids.length > 0) {
      query = query.where('search_log_ids', '&&', pattern.search_log_ids)
    }

    return query.executeTakeFirst()
  }

  private getExpirationDate(days: number = this.config.insightCacheDays): Date {
    const expiry = new Date()
    expiry.setDate(expiry.getDate() + days)
    return expiry
  }
}

export const patternService = new PatternService()
