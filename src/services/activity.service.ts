import { db } from '../db/index.js'

export interface CurrentSession {
  session_id: number
  app: string
  window_title: string
  url: string | null
  site: string
  duration_min: number
  doc_id: number | null
  doc_title: string | null
}

export interface CurrentContext {
  current_session: CurrentSession | null
  recent_sessions: {
    app: string
    duration_min: number
    site: string
    doc_id: number | null
  }[]
  related_documents: {
    doc_id: number
    title: string | null
    url: string
    relevance: string
  }[]
}

export interface ActivitySearchParams {
  query?: string
  apps?: string[]
  timeRange?: { start: string; end: string }
  activityType?: 'active' | 'idle' | 'meeting'
  withDocuments?: boolean
  limit?: number
}

export interface ActivitySearchResult {
  session_id: number
  start_at: string
  end_at: string
  app: string
  window_title: string
  site: string
  duration_min: number
  activity_type: string
  doc_id: number | null
  doc_title: string | null
  url: string | null
}

export interface ActivityAroundDocument {
  document: {
    doc_id: number
    title: string | null
    url: string
  }
  visits: {
    visited_at: string
    duration_seconds: number | null
    before_context: ActivitySearchResult[]
    after_context: ActivitySearchResult[]
  }[]
}

export interface DailySummary {
  date: string
  time_breakdown: {
    active_min: number
    idle_min: number
    meeting_min: number
  }
  top_apps: { app: string; minutes: number }[]
  top_sites: { site: string; minutes: number }[]
  documents_read: { doc_id: number; title: string | null; duration_min: number }[]
  timeline: { time: string; app: string; description: string }[]
}

class ActivityService {
  async getCurrentContext(lookbackMinutes: number = 30): Promise<CurrentContext> {
    const cutoff = new Date(Date.now() - lookbackMinutes * 60 * 1000)

    const recentSessions = await db
      .selectFrom('activity_session as s')
      .leftJoin('document as d', 'd.doc_id', 's.doc_id')
      .leftJoin('url as u', 'u.url_id', 's.url_id')
      .select([
        's.session_id',
        's.app',
        's.window_title',
        's.site',
        's.duration_seconds',
        's.doc_id',
        's.start_at',
        's.end_at',
        'd.title as doc_title',
        'u.url_norm as url',
      ])
      .where('s.end_at', '>', cutoff)
      .orderBy('s.end_at', 'desc')
      .limit(20)
      .execute()

    const currentSession =
      recentSessions.length > 0
        ? {
            session_id: recentSessions[0].session_id,
            app: recentSessions[0].app,
            window_title: recentSessions[0].window_title,
            url: recentSessions[0].url,
            site: recentSessions[0].site,
            duration_min: Math.round((recentSessions[0].duration_seconds / 60) * 10) / 10,
            doc_id: recentSessions[0].doc_id,
            doc_title: recentSessions[0].doc_title,
          }
        : null

    const appTotals = new Map<
      string,
      { duration: number; site: string; doc_id: number | null }
    >()
    for (const s of recentSessions.slice(1)) {
      const key = s.app
      const existing = appTotals.get(key) || { duration: 0, site: '', doc_id: null }
      existing.duration += s.duration_seconds
      if (!existing.site && s.site) existing.site = s.site
      if (!existing.doc_id && s.doc_id) existing.doc_id = s.doc_id
      appTotals.set(key, existing)
    }

    const recent = Array.from(appTotals.entries())
      .map(([app, data]) => ({
        app,
        duration_min: Math.round((data.duration / 60) * 10) / 10,
        site: data.site,
        doc_id: data.doc_id,
      }))
      .sort((a, b) => b.duration_min - a.duration_min)

    const docIds = recentSessions.filter((s) => s.doc_id).map((s) => s.doc_id as number)
    const uniqueDocIds = [...new Set(docIds)]

    const relatedDocs: CurrentContext['related_documents'] = []
    if (uniqueDocIds.length > 0) {
      const docs = await db
        .selectFrom('document as d')
        .innerJoin('url as u', 'u.url_id', 'd.url_id')
        .select(['d.doc_id', 'd.title', 'u.url_norm as url'])
        .where('d.doc_id', 'in', uniqueDocIds)
        .execute()

      for (const doc of docs) {
        const idx = uniqueDocIds.indexOf(doc.doc_id)
        relatedDocs.push({
          doc_id: doc.doc_id,
          title: doc.title,
          url: doc.url,
          relevance: idx === 0 ? 'currently viewing' : 'recent',
        })
      }
    }

    return {
      current_session: currentSession,
      recent_sessions: recent,
      related_documents: relatedDocs,
    }
  }

  async searchActivity(params: ActivitySearchParams): Promise<ActivitySearchResult[]> {
    const limit = params.limit || 20

    let query = db
      .selectFrom('activity_session as s')
      .leftJoin('document as d', 'd.doc_id', 's.doc_id')
      .leftJoin('url as u', 'u.url_id', 's.url_id')
      .select([
        's.session_id',
        's.start_at',
        's.end_at',
        's.app',
        's.window_title',
        's.site',
        's.duration_seconds',
        's.activity_type',
        's.doc_id',
        'd.title as doc_title',
        'u.url_norm as url',
      ])
      .orderBy('s.start_at', 'desc')
      .limit(limit)

    if (params.query) {
      query = query.where((eb) =>
        eb.or([
          eb('s.window_title', 'ilike', `%${params.query}%`),
          eb('s.site', 'ilike', `%${params.query}%`),
          eb('d.title', 'ilike', `%${params.query}%`),
        ]),
      )
    }

    if (params.apps && params.apps.length > 0) {
      query = query.where('s.app', 'in', params.apps)
    }

    if (params.timeRange?.start) {
      query = query.where('s.start_at', '>=', new Date(params.timeRange.start))
    }

    if (params.timeRange?.end) {
      query = query.where('s.end_at', '<=', new Date(params.timeRange.end))
    }

    if (params.activityType) {
      query = query.where('s.activity_type', '=', params.activityType)
    }

    if (params.withDocuments) {
      query = query.where('s.doc_id', 'is not', null)
    }

    const results = await query.execute()

    return results.map((r) => ({
      session_id: r.session_id,
      start_at: r.start_at.toISOString(),
      end_at: r.end_at.toISOString(),
      app: r.app,
      window_title: r.window_title,
      site: r.site,
      duration_min: Math.round((r.duration_seconds / 60) * 10) / 10,
      activity_type: r.activity_type,
      doc_id: r.doc_id,
      doc_title: r.doc_title,
      url: r.url,
    }))
  }

  async getActivityAroundDocument(
    docId: number,
    contextMinutes: number = 30,
  ): Promise<ActivityAroundDocument | null> {
    const doc = await db
      .selectFrom('document as d')
      .innerJoin('url as u', 'u.url_id', 'd.url_id')
      .select(['d.doc_id', 'd.title', 'u.url_norm as url', 'd.url_id'])
      .where('d.doc_id', '=', docId)
      .executeTakeFirst()

    if (!doc) return null

    const visits = await db
      .selectFrom('visit')
      .select('visited_at')
      .where('url_id', '=', doc.url_id)
      .orderBy('visited_at', 'desc')
      .limit(10)
      .execute()

    const visitContexts = await Promise.all(
      visits.map(async (v) => {
        const visitTime = v.visited_at
        const beforeCutoff = new Date(visitTime.getTime() - contextMinutes * 60 * 1000)
        const afterCutoff = new Date(visitTime.getTime() + contextMinutes * 60 * 1000)

        const [before, after] = await Promise.all([
          this.searchActivity({
            timeRange: {
              start: beforeCutoff.toISOString(),
              end: visitTime.toISOString(),
            },
            limit: 10,
          }),
          this.searchActivity({
            timeRange: { start: visitTime.toISOString(), end: afterCutoff.toISOString() },
            limit: 10,
          }),
        ])

        return {
          visited_at: visitTime.toISOString(),
          duration_seconds: null,
          before_context: before.reverse(),
          after_context: after,
        }
      }),
    )

    return {
      document: {
        doc_id: doc.doc_id,
        title: doc.title,
        url: doc.url,
      },
      visits: visitContexts,
    }
  }

  async getDailySummary(dateStr?: string): Promise<DailySummary> {
    const targetDate = dateStr ? new Date(dateStr) : new Date()
    targetDate.setHours(0, 0, 0, 0)

    const nextDate = new Date(targetDate)
    nextDate.setDate(nextDate.getDate() + 1)

    const sessions = await db
      .selectFrom('activity_session as s')
      .leftJoin('document as d', 'd.doc_id', 's.doc_id')
      .select([
        's.session_id',
        's.start_at',
        's.end_at',
        's.app',
        's.window_title',
        's.site',
        's.duration_seconds',
        's.activity_type',
        's.doc_id',
        'd.title as doc_title',
      ])
      .where('s.source_date', '=', targetDate)
      .orderBy('s.start_at')
      .execute()

    let activeSec = 0
    let idleSec = 0
    let meetingSec = 0
    const appTotals = new Map<string, number>()
    const siteTotals = new Map<string, number>()
    const docTotals = new Map<number, { title: string | null; seconds: number }>()

    for (const s of sessions) {
      const dur = s.duration_seconds

      switch (s.activity_type) {
        case 'active':
          activeSec += dur
          break
        case 'idle':
          idleSec += dur
          break
        case 'meeting':
          meetingSec += dur
          break
      }

      appTotals.set(s.app, (appTotals.get(s.app) || 0) + dur)

      if (s.site) {
        siteTotals.set(s.site, (siteTotals.get(s.site) || 0) + dur)
      }

      if (s.doc_id) {
        const existing = docTotals.get(s.doc_id) || { title: s.doc_title, seconds: 0 }
        existing.seconds += dur
        docTotals.set(s.doc_id, existing)
      }
    }

    const topApps = Array.from(appTotals.entries())
      .map(([app, seconds]) => ({ app, minutes: Math.round((seconds / 60) * 10) / 10 }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 10)

    const topSites = Array.from(siteTotals.entries())
      .map(([site, seconds]) => ({ site, minutes: Math.round((seconds / 60) * 10) / 10 }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 10)

    const documentsRead = Array.from(docTotals.entries())
      .map(([doc_id, data]) => ({
        doc_id,
        title: data.title,
        duration_min: Math.round((data.seconds / 60) * 10) / 10,
      }))
      .sort((a, b) => b.duration_min - a.duration_min)
      .slice(0, 10)

    const timeline = sessions
      .filter((s) => s.duration_seconds >= 60)
      .slice(0, 50)
      .map((s) => ({
        time: s.start_at.toTimeString().slice(0, 5),
        app: s.app,
        description: s.site || s.window_title || s.app,
      }))

    return {
      date: targetDate.toISOString().slice(0, 10),
      time_breakdown: {
        active_min: Math.round(activeSec / 60),
        idle_min: Math.round(idleSec / 60),
        meeting_min: Math.round(meetingSec / 60),
      },
      top_apps: topApps,
      top_sites: topSites,
      documents_read: documentsRead,
      timeline,
    }
  }
}

export const activityService = new ActivityService()
