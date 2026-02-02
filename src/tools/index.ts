/**
 * MCP Tool definitions for web memory agent
 *
 * These tools can be exposed via an MCP server or used directly.
 */

import { searchService } from '../services/search.service.js'
import { activityService } from '../services/activity.service.js'
import { patternService } from '../services/pattern.service.js'
import { taskService } from '../services/task.service.js'

import type {
  SearchParams,
  SearchResult,
  DocumentResult,
  WeeklyRecap,
} from '../services/search.service.js'
import type {
  CurrentContext,
  ActivitySearchResult,
  ActivityAroundDocument,
  DailySummary,
} from '../services/activity.service.js'
import type { DetectedPattern } from '../services/pattern.service.js'
import type {
  Insight,
  Task,
  InsightType,
  InsightStatus,
  TaskStatus,
  TaskSource,
} from '../db/schema.js'

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
}

// Tool definitions for MCP
export const toolDefinitions: ToolDefinition[] = [
  {
    name: 'search_memory',
    description:
      'Search your web browsing memory. Returns relevant passages from pages you visited, with citation handles for precise referencing. Use semantic mode for conceptual searches, keyword mode for exact matches, or hybrid for best results.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
        },
        mode: {
          type: 'string',
          enum: ['semantic', 'keyword', 'hybrid'],
          description:
            'Search mode: semantic (conceptual), keyword (exact), or hybrid (both)',
          default: 'hybrid',
        },
        time_range: {
          type: 'object',
          properties: {
            start: { type: 'string', description: 'ISO date string for range start' },
            end: { type: 'string', description: 'ISO date string for range end' },
          },
          description: 'Optional time range filter',
        },
        domains: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional list of domains to filter by',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 10)',
          default: 10,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_document',
    description:
      'Retrieve a full document from memory by its ID. Use this to expand context around a search result or read the complete content of a previously visited page.',
    inputSchema: {
      type: 'object',
      properties: {
        doc_id: {
          type: 'number',
          description: 'The document ID to retrieve',
        },
        include_chunks: {
          type: 'boolean',
          description: 'Whether to include the chunked content',
          default: false,
        },
        chunk_range: {
          type: 'object',
          properties: {
            start: { type: 'number', description: 'Start chunk index' },
            end: { type: 'number', description: 'End chunk index' },
          },
          description: 'Optional range of chunks to retrieve',
        },
      },
      required: ['doc_id'],
    },
  },
  {
    name: 'weekly_recap',
    description:
      'Get a summary of browsing activity for a specific week. Shows notable documents, visit counts, and themes from your reading during that period.',
    inputSchema: {
      type: 'object',
      properties: {
        week_of: {
          type: 'string',
          description:
            'ISO date string - the week containing this date will be summarized',
        },
      },
      required: ['week_of'],
    },
  },
  {
    name: 'get_current_context',
    description:
      'Get current working context - what the user is doing right now and what they were doing recently. Returns current app/window, recent sessions aggregated by app, and any related documents being viewed.',
    inputSchema: {
      type: 'object',
      properties: {
        lookback_minutes: {
          type: 'number',
          description: 'How far back to look for recent activity (default: 30)',
          default: 30,
        },
      },
    },
  },
  {
    name: 'search_activity',
    description:
      'Search activity history by app, time, window/tab titles, or sites. Find what the user was doing at a specific time, with a specific app, or related to certain content.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query - searches window titles, tab titles, and sites',
        },
        apps: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by app names (e.g., ["VS Code", "Google Chrome"])',
        },
        time_range: {
          type: 'object',
          properties: {
            start: { type: 'string', description: 'ISO date string for range start' },
            end: { type: 'string', description: 'ISO date string for range end' },
          },
          description: 'Time range filter',
        },
        activity_type: {
          type: 'string',
          enum: ['active', 'idle', 'meeting'],
          description: 'Filter by activity type',
        },
        with_documents: {
          type: 'boolean',
          description: 'Only return sessions linked to web documents',
          default: false,
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 20)',
          default: 20,
        },
      },
    },
  },
  {
    name: 'get_activity_around_document',
    description:
      'Get activity context around when a document was visited. Answers "what was I working on when I read this?" by showing activity before and after document visits.',
    inputSchema: {
      type: 'object',
      properties: {
        doc_id: {
          type: 'number',
          description: 'The document ID to get context around',
        },
        context_minutes: {
          type: 'number',
          description: 'Minutes of context to show before/after each visit (default: 30)',
          default: 30,
        },
      },
      required: ['doc_id'],
    },
  },
  {
    name: 'get_daily_summary',
    description:
      'Get a summary of activity for a specific day. Shows time breakdown by activity type, top apps and sites, documents read, and a timeline of activities.',
    inputSchema: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'ISO date string (YYYY-MM-DD). Defaults to today.',
        },
      },
    },
  },
  // Phase 5: Proactive Insights & Tasks
  {
    name: 'get_open_loops',
    description:
      'Find abandoned research - documents you visited briefly but never returned to. Surfaces potential "open loops" in your learning that may be worth revisiting or closing.',
    inputSchema: {
      type: 'object',
      properties: {
        min_days_old: {
          type: 'number',
          description: 'Minimum days since last visit (default: 7)',
          default: 7,
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 10)',
          default: 10,
        },
      },
    },
  },
  {
    name: 'get_insights',
    description:
      'Get proactive insights detected from your browsing and activity patterns. Includes open loops, repeated searches, stale topics, and context switch patterns.',
    inputSchema: {
      type: 'object',
      properties: {
        types: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['open_loop', 'repeated_search', 'stale_topic', 'context_switch'],
          },
          description: 'Filter by insight types',
        },
        status: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['new', 'acknowledged', 'dismissed', 'resolved'],
          },
          description: 'Filter by status (default: new, acknowledged)',
        },
        min_confidence: {
          type: 'number',
          description: 'Minimum confidence score (0-1)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 10)',
          default: 10,
        },
      },
    },
  },
  {
    name: 'refresh_insights',
    description:
      'Run pattern detection to refresh insights. Detects open loops, repeated searches, stale expertise, and context switch patterns from recent activity.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'acknowledge_insight',
    description: 'Mark an insight as acknowledged (user has seen it).',
    inputSchema: {
      type: 'object',
      properties: {
        insight_id: {
          type: 'number',
          description: 'The insight ID to acknowledge',
        },
      },
      required: ['insight_id'],
    },
  },
  {
    name: 'dismiss_insight',
    description: 'Dismiss an insight (hide it, user is not interested).',
    inputSchema: {
      type: 'object',
      properties: {
        insight_id: {
          type: 'number',
          description: 'The insight ID to dismiss',
        },
      },
      required: ['insight_id'],
    },
  },
  {
    name: 'suggest_tasks',
    description:
      'Get proactive task suggestions based on detected patterns. Returns actionable recommendations from insights.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum suggestions (default: 5)',
          default: 5,
        },
      },
    },
  },
  {
    name: 'get_tasks',
    description:
      'Get tasks - both user-created and agent-suggested. Filter by status, source, priority, or due date.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed', 'archived'],
          },
          description: 'Filter by status (default: pending, in_progress)',
        },
        source: {
          type: 'string',
          enum: ['user', 'agent'],
          description: 'Filter by task source',
        },
        include_overdue: {
          type: 'boolean',
          description: 'Include overdue tasks at top',
          default: true,
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default: 20)',
          default: 20,
        },
      },
    },
  },
  {
    name: 'create_task',
    description: 'Create a new task. Can be user-created or converted from an insight.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Task title',
        },
        description: {
          type: 'string',
          description: 'Task description',
        },
        priority: {
          type: 'number',
          description: 'Priority 1-10 (1=highest, default: 5)',
          default: 5,
        },
        due_date: {
          type: 'string',
          description: 'Due date (YYYY-MM-DD)',
        },
        insight_id: {
          type: 'number',
          description: 'Create from insight ID',
        },
        doc_ids: {
          type: 'array',
          items: { type: 'number' },
          description: 'Related document IDs',
        },
      },
      required: ['title'],
    },
  },
  {
    name: 'update_task',
    description: 'Update an existing task - change status, priority, due date, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'number',
          description: 'Task ID to update',
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'archived'],
          description: 'New status',
        },
        title: {
          type: 'string',
          description: 'New title',
        },
        priority: {
          type: 'number',
          description: 'New priority (1-10)',
        },
        due_date: {
          type: 'string',
          description: 'New due date (YYYY-MM-DD or null to clear)',
        },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'get_task_stats',
    description: 'Get task statistics - pending, in progress, completed, overdue counts.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
]

// Tool handlers
export async function handleSearchMemory(params: {
  query: string
  mode?: 'semantic' | 'keyword' | 'hybrid'
  time_range?: { start: string; end: string }
  domains?: string[]
  limit?: number
}): Promise<SearchResult[]> {
  const searchParams: SearchParams = {
    query: params.query,
    mode: params.mode || 'hybrid',
    timeRange: params.time_range,
    domains: params.domains,
    limit: params.limit,
  }

  return searchService.search(searchParams)
}

export async function handleGetDocument(params: {
  doc_id: number
  include_chunks?: boolean
  chunk_range?: { start: number; end: number }
}): Promise<DocumentResult | null> {
  return searchService.getDocument(
    params.doc_id,
    params.include_chunks,
    params.chunk_range,
  )
}

export async function handleWeeklyRecap(params: {
  week_of: string
}): Promise<WeeklyRecap> {
  return searchService.getWeeklyRecap(params.week_of)
}

export async function handleGetCurrentContext(params: {
  lookback_minutes?: number
}): Promise<CurrentContext> {
  return activityService.getCurrentContext(params.lookback_minutes)
}

export async function handleSearchActivity(params: {
  query?: string
  apps?: string[]
  time_range?: { start: string; end: string }
  activity_type?: 'active' | 'idle' | 'meeting'
  with_documents?: boolean
  limit?: number
}): Promise<ActivitySearchResult[]> {
  return activityService.searchActivity({
    query: params.query,
    apps: params.apps,
    timeRange: params.time_range,
    activityType: params.activity_type,
    withDocuments: params.with_documents,
    limit: params.limit,
  })
}

export async function handleGetActivityAroundDocument(params: {
  doc_id: number
  context_minutes?: number
}): Promise<ActivityAroundDocument | null> {
  return activityService.getActivityAroundDocument(params.doc_id, params.context_minutes)
}

export async function handleGetDailySummary(params: {
  date?: string
}): Promise<DailySummary> {
  return activityService.getDailySummary(params.date)
}

// Phase 5: Insight & Task handlers

export async function handleGetOpenLoops(params: {
  min_days_old?: number
  limit?: number
}): Promise<DetectedPattern[]> {
  const patterns = await patternService.detectOpenLoops({
    minDaysOld: params.min_days_old,
  })
  return patterns.slice(0, params.limit || 10)
}

export async function handleGetInsights(params: {
  types?: InsightType[]
  status?: InsightStatus[]
  min_confidence?: number
  limit?: number
}): Promise<Insight[]> {
  return patternService.getActiveInsights({
    types: params.types,
    status: params.status,
    minConfidence: params.min_confidence,
    limit: params.limit,
  })
}

export async function handleRefreshInsights(): Promise<{
  detected: number
  created: number
  updated: number
  expired: number
}> {
  return patternService.refreshInsights()
}

export async function handleAcknowledgeInsight(params: {
  insight_id: number
}): Promise<{ success: boolean }> {
  await patternService.acknowledgeInsight(params.insight_id)
  return { success: true }
}

export async function handleDismissInsight(params: {
  insight_id: number
}): Promise<{ success: boolean }> {
  await patternService.dismissInsight(params.insight_id)
  return { success: true }
}

export async function handleSuggestTasks(params: { limit?: number }): Promise<
  Array<{
    suggestion: string
    insight: Insight
    can_create_task: boolean
  }>
> {
  const insights = await patternService.getActiveInsights({
    status: ['new'],
    limit: params.limit || 5,
  })

  return insights
    .filter((i) => i.suggestion)
    .map((i) => ({
      suggestion: i.suggestion!,
      insight: i,
      can_create_task: true,
    }))
}

export async function handleGetTasks(params: {
  status?: TaskStatus[]
  source?: TaskSource
  include_overdue?: boolean
  limit?: number
}): Promise<{
  tasks: Task[]
  overdue?: Task[]
  stats: { pending: number; in_progress: number }
}> {
  const [tasks, overdue, stats] = await Promise.all([
    taskService.getActiveTasks({
      status: params.status,
      source: params.source,
      limit: params.limit,
    }),
    params.include_overdue !== false
      ? taskService.getOverdueTasks()
      : Promise.resolve([]),
    taskService.getTaskStats(),
  ])

  return {
    tasks,
    overdue: params.include_overdue !== false ? overdue : undefined,
    stats: {
      pending: stats.pending,
      in_progress: stats.in_progress,
    },
  }
}

export async function handleCreateTask(params: {
  title: string
  description?: string
  priority?: number
  due_date?: string
  insight_id?: number
  doc_ids?: number[]
}): Promise<Task> {
  if (params.insight_id) {
    const task = await taskService.createTaskFromInsight(params.insight_id, {
      title: params.title,
      description: params.description,
      priority: params.priority,
      due_date: params.due_date,
    })
    if (task) return task
  }

  return taskService.createTask({
    title: params.title,
    description: params.description,
    source: params.insight_id ? 'agent' : 'user',
    priority: params.priority,
    due_date: params.due_date,
    doc_ids: params.doc_ids,
  })
}

export async function handleUpdateTask(params: {
  task_id: number
  status?: TaskStatus
  title?: string
  priority?: number
  due_date?: string | null
}): Promise<Task | null> {
  return taskService.updateTask(params.task_id, {
    status: params.status,
    title: params.title,
    priority: params.priority,
    due_date: params.due_date,
  })
}

export async function handleGetTaskStats(): Promise<{
  pending: number
  in_progress: number
  completed_today: number
  completed_week: number
  overdue: number
  by_source: { user: number; agent: number }
}> {
  return taskService.getTaskStats()
}

// Generic tool dispatcher
export async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  let result: unknown

  switch (name) {
    case 'search_memory':
      result = await handleSearchMemory(args as Parameters<typeof handleSearchMemory>[0])
      break
    case 'get_document':
      result = await handleGetDocument(args as Parameters<typeof handleGetDocument>[0])
      break
    case 'weekly_recap':
      result = await handleWeeklyRecap(args as Parameters<typeof handleWeeklyRecap>[0])
      break
    case 'get_current_context':
      result = await handleGetCurrentContext(
        args as Parameters<typeof handleGetCurrentContext>[0],
      )
      break
    case 'search_activity':
      result = await handleSearchActivity(
        args as Parameters<typeof handleSearchActivity>[0],
      )
      break
    case 'get_activity_around_document':
      result = await handleGetActivityAroundDocument(
        args as Parameters<typeof handleGetActivityAroundDocument>[0],
      )
      break
    case 'get_daily_summary':
      result = await handleGetDailySummary(
        args as Parameters<typeof handleGetDailySummary>[0],
      )
      break
    // Phase 5: Insight & Task tools
    case 'get_open_loops':
      result = await handleGetOpenLoops(args as Parameters<typeof handleGetOpenLoops>[0])
      break
    case 'get_insights':
      result = await handleGetInsights(args as Parameters<typeof handleGetInsights>[0])
      break
    case 'refresh_insights':
      result = await handleRefreshInsights()
      break
    case 'acknowledge_insight':
      result = await handleAcknowledgeInsight(
        args as Parameters<typeof handleAcknowledgeInsight>[0],
      )
      break
    case 'dismiss_insight':
      result = await handleDismissInsight(
        args as Parameters<typeof handleDismissInsight>[0],
      )
      break
    case 'suggest_tasks':
      result = await handleSuggestTasks(args as Parameters<typeof handleSuggestTasks>[0])
      break
    case 'get_tasks':
      result = await handleGetTasks(args as Parameters<typeof handleGetTasks>[0])
      break
    case 'create_task':
      result = await handleCreateTask(args as Parameters<typeof handleCreateTask>[0])
      break
    case 'update_task':
      result = await handleUpdateTask(args as Parameters<typeof handleUpdateTask>[0])
      break
    case 'get_task_stats':
      result = await handleGetTaskStats()
      break
    default:
      throw new Error(`Unknown tool: ${name}`)
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  }
}
