import type { Generated, Insertable, Selectable, Updateable } from 'kysely'

export interface UrlTable {
  url_id: Generated<number>
  url_norm: string
  domain: string
  path: string | null
  first_seen_at: Generated<Date>
  last_seen_at: Generated<Date>
}

export interface VisitTable {
  visit_id: Generated<number>
  url_id: number
  visited_at: Date
  referrer_url_id: number | null
}

export interface DocumentTable {
  doc_id: Generated<number>
  url_id: number
  content_hash: string
  title: string | null
  author: string | null
  published_at: Date | null
  fetched_at: Generated<Date>
  status: Generated<string>
  lang: string | null
  text_length: number | null
  html_key: string | null
  markdown_key: string | null
  search_vector: string | null
}

export interface ChunkTable {
  chunk_id: Generated<number>
  doc_id: number
  chunk_index: number
  chunk_type: string | null
  heading: string | null
  text: string
  token_count: number | null
  char_start: number | null
  char_end: number | null
  embedding: number[] | null
}

export interface TagTable {
  tag_id: Generated<number>
  name: string
}

export interface DocTagTable {
  doc_id: number
  tag_id: number
  score: number | null
  source: string | null
}

export type ActivityType = 'active' | 'idle' | 'meeting'

export interface ActivitySessionTable {
  session_id: Generated<number>
  start_at: Date
  end_at: Date
  app: string
  window_title: string
  url_id: number | null
  site: string
  activity_type: ActivityType
  duration_seconds: Generated<number>
  doc_id: number | null
  source_date: Date
  created_at: Generated<Date>
}

export interface TracksImportTable {
  import_id: Generated<number>
  source_file: string
  file_date: Date
  rows_imported: number
  sessions_created: number
  last_row_ts: Date | null
  imported_at: Generated<Date>
}

// Phase 5: Proactive Insights & Tasks

export type InsightType =
  | 'open_loop'
  | 'repeated_search'
  | 'stale_topic'
  | 'context_switch'
  | 'research_thread'
  | 'reading_spike'

export type InsightStatus = 'new' | 'acknowledged' | 'dismissed' | 'resolved'

export interface InsightTable {
  insight_id: Generated<number>
  type: InsightType
  status: InsightStatus
  confidence: number
  priority: number
  title: string
  description: string | null
  suggestion: string | null
  doc_ids: number[]
  url_ids: number[]
  tag_ids: number[]
  chunk_ids: number[]
  session_ids: number[]
  search_log_ids: number[]
  metadata: Record<string, unknown>
  detected_at: Generated<Date>
  expires_at: Date | null
  acknowledged_at: Date | null
  resolved_at: Date | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export type TaskSource = 'user' | 'agent'
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'archived'

export interface TaskTable {
  task_id: Generated<number>
  title: string
  description: string | null
  source: TaskSource
  status: TaskStatus
  priority: number
  due_date: Date | null
  reminder_at: Date | null
  insight_id: number | null
  doc_ids: number[]
  url_ids: number[]
  tag_ids: number[]
  metadata: Record<string, unknown>
  created_at: Generated<Date>
  updated_at: Generated<Date>
  started_at: Date | null
  completed_at: Date | null
  archived_at: Date | null
}

export type SearchMode = 'semantic' | 'keyword' | 'hybrid'

export interface SearchLogTable {
  search_id: Generated<number>
  query_text: string
  query_embedding: number[] | null
  search_mode: SearchMode
  time_range_start: Date | null
  time_range_end: Date | null
  domains: string[] | null
  results_count: number
  clicked_doc_ids: number[]
  top_result_doc_id: number | null
  session_id: number | null
  searched_at: Generated<Date>
}

export interface Database {
  url: UrlTable
  visit: VisitTable
  document: DocumentTable
  chunk: ChunkTable
  tag: TagTable
  doc_tag: DocTagTable
  activity_session: ActivitySessionTable
  tracks_import: TracksImportTable
  insight: InsightTable
  task: TaskTable
  search_log: SearchLogTable
}

export type Url = Selectable<UrlTable>
export type NewUrl = Insertable<UrlTable>
export type UrlUpdate = Updateable<UrlTable>

export type Visit = Selectable<VisitTable>
export type NewVisit = Insertable<VisitTable>

export type Document = Selectable<DocumentTable>
export type NewDocument = Insertable<DocumentTable>
export type DocumentUpdate = Updateable<DocumentTable>

export type Chunk = Selectable<ChunkTable>
export type NewChunk = Insertable<ChunkTable>
export type ChunkUpdate = Updateable<ChunkTable>

export type Tag = Selectable<TagTable>
export type NewTag = Insertable<TagTable>

export type DocTag = Selectable<DocTagTable>
export type NewDocTag = Insertable<DocTagTable>

export type ActivitySession = Selectable<ActivitySessionTable>
export type NewActivitySession = Insertable<ActivitySessionTable>
export type ActivitySessionUpdate = Updateable<ActivitySessionTable>

export type TracksImport = Selectable<TracksImportTable>
export type NewTracksImport = Insertable<TracksImportTable>

export type Insight = Selectable<InsightTable>
export type NewInsight = Insertable<InsightTable>
export type InsightUpdate = Updateable<InsightTable>

export type Task = Selectable<TaskTable>
export type NewTask = Insertable<TaskTable>
export type TaskUpdate = Updateable<TaskTable>

export type SearchLog = Selectable<SearchLogTable>
export type NewSearchLog = Insertable<SearchLogTable>
