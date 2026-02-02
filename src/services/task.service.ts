import { db } from '../db/index.js'
import type {
  Task,
  NewTask,
  TaskUpdate,
  TaskStatus,
  TaskSource,
  Insight,
} from '../db/schema.js'

export interface CreateTaskParams {
  title: string
  description?: string
  source: TaskSource
  priority?: number
  due_date?: string | Date
  reminder_at?: string | Date
  insight_id?: number
  doc_ids?: number[]
  url_ids?: number[]
  tag_ids?: number[]
  metadata?: Record<string, unknown>
}

export interface UpdateTaskParams {
  title?: string
  description?: string
  status?: TaskStatus
  priority?: number
  due_date?: string | Date | null
  reminder_at?: string | Date | null
  metadata?: Record<string, unknown>
}

export interface TaskWithInsight extends Task {
  insight?: Insight | null
}

export interface TaskFilter {
  status?: TaskStatus[]
  source?: TaskSource
  minPriority?: number
  maxPriority?: number
  hasDueDate?: boolean
  includeInsight?: boolean
  limit?: number
}

class TaskService {
  /**
   * Create a new task (user or agent).
   */
  async createTask(params: CreateTaskParams): Promise<Task> {
    const task: NewTask = {
      title: params.title,
      description: params.description || null,
      source: params.source,
      status: 'pending',
      priority: params.priority ?? 5,
      due_date: params.due_date ? new Date(params.due_date) : null,
      reminder_at: params.reminder_at ? new Date(params.reminder_at) : null,
      insight_id: params.insight_id || null,
      doc_ids: params.doc_ids || [],
      url_ids: params.url_ids || [],
      tag_ids: params.tag_ids || [],
      metadata: params.metadata || {},
    }

    const result = await db
      .insertInto('task')
      .values(task)
      .returningAll()
      .executeTakeFirstOrThrow()

    return result
  }

  /**
   * Update an existing task.
   */
  async updateTask(taskId: number, params: UpdateTaskParams): Promise<Task | null> {
    const updates: TaskUpdate = {}

    if (params.title !== undefined) updates.title = params.title
    if (params.description !== undefined) updates.description = params.description
    if (params.priority !== undefined) updates.priority = params.priority
    if (params.metadata !== undefined) updates.metadata = params.metadata

    if (params.due_date !== undefined) {
      updates.due_date = params.due_date ? new Date(params.due_date) : null
    }
    if (params.reminder_at !== undefined) {
      updates.reminder_at = params.reminder_at ? new Date(params.reminder_at) : null
    }

    if (params.status !== undefined) {
      updates.status = params.status

      switch (params.status) {
        case 'in_progress':
          updates.started_at = new Date()
          break
        case 'completed':
          updates.completed_at = new Date()
          break
        case 'archived':
          updates.archived_at = new Date()
          break
      }
    }

    if (Object.keys(updates).length === 0) {
      return this.getTask(taskId)
    }

    const result = await db
      .updateTable('task')
      .set(updates)
      .where('task_id', '=', taskId)
      .returningAll()
      .executeTakeFirst()

    return result || null
  }

  /**
   * Get a single task by ID.
   */
  async getTask(taskId: number, includeInsight = false): Promise<TaskWithInsight | null> {
    const task = await db
      .selectFrom('task')
      .selectAll()
      .where('task_id', '=', taskId)
      .executeTakeFirst()

    if (!task) return null

    if (includeInsight && task.insight_id) {
      const insight = await db
        .selectFrom('insight')
        .selectAll()
        .where('insight_id', '=', task.insight_id)
        .executeTakeFirst()

      return { ...task, insight }
    }

    return task
  }

  /**
   * Get active tasks (pending or in_progress).
   */
  async getActiveTasks(filter: TaskFilter = {}): Promise<TaskWithInsight[]> {
    let query = db
      .selectFrom('task')
      .selectAll()
      .where('status', 'in', filter.status || ['pending', 'in_progress'])
      .orderBy('priority', 'asc')
      .orderBy('created_at', 'desc')

    if (filter.source) {
      query = query.where('source', '=', filter.source)
    }

    if (filter.minPriority) {
      query = query.where('priority', '>=', filter.minPriority)
    }

    if (filter.maxPriority) {
      query = query.where('priority', '<=', filter.maxPriority)
    }

    if (filter.hasDueDate === true) {
      query = query.where('due_date', 'is not', null)
    } else if (filter.hasDueDate === false) {
      query = query.where('due_date', 'is', null)
    }

    if (filter.limit) {
      query = query.limit(filter.limit)
    }

    const tasks = await query.execute()

    if (filter.includeInsight) {
      const insightIds = tasks
        .map((t) => t.insight_id)
        .filter((id): id is number => id !== null)

      if (insightIds.length > 0) {
        const insights = await db
          .selectFrom('insight')
          .selectAll()
          .where('insight_id', 'in', insightIds)
          .execute()

        const insightMap = new Map(insights.map((i) => [i.insight_id, i]))

        return tasks.map((task) => ({
          ...task,
          insight: task.insight_id ? insightMap.get(task.insight_id) : undefined,
        }))
      }
    }

    return tasks
  }

  /**
   * Get tasks by status.
   */
  async getTasksByStatus(status: TaskStatus, limit = 20): Promise<Task[]> {
    return db
      .selectFrom('task')
      .selectAll()
      .where('status', '=', status)
      .orderBy('priority', 'asc')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute()
  }

  /**
   * Get overdue tasks (past due date, not completed/archived).
   */
  async getOverdueTasks(): Promise<Task[]> {
    const now = new Date()
    now.setHours(0, 0, 0, 0)

    return db
      .selectFrom('task')
      .selectAll()
      .where('status', 'in', ['pending', 'in_progress'])
      .where('due_date', '<', now)
      .orderBy('due_date', 'asc')
      .execute()
  }

  /**
   * Get upcoming tasks (due within N days).
   */
  async getUpcomingTasks(days = 7): Promise<Task[]> {
    const now = new Date()
    now.setHours(0, 0, 0, 0)

    const future = new Date(now)
    future.setDate(future.getDate() + days)

    return db
      .selectFrom('task')
      .selectAll()
      .where('status', 'in', ['pending', 'in_progress'])
      .where('due_date', '>=', now)
      .where('due_date', '<=', future)
      .orderBy('due_date', 'asc')
      .execute()
  }

  /**
   * Create task from an insight suggestion.
   */
  async createTaskFromInsight(
    insightId: number,
    overrides: Partial<CreateTaskParams> = {},
  ): Promise<Task | null> {
    const insight = await db
      .selectFrom('insight')
      .selectAll()
      .where('insight_id', '=', insightId)
      .executeTakeFirst()

    if (!insight) return null

    const task = await this.createTask({
      title: overrides.title || insight.suggestion || insight.title,
      description: overrides.description || insight.description || undefined,
      source: 'agent',
      priority: overrides.priority ?? insight.priority,
      insight_id: insightId,
      doc_ids: insight.doc_ids,
      url_ids: insight.url_ids,
      tag_ids: insight.tag_ids,
      ...overrides,
    })

    await db
      .updateTable('insight')
      .set({ status: 'acknowledged', acknowledged_at: new Date() })
      .where('insight_id', '=', insightId)
      .execute()

    return task
  }

  /**
   * Archive old completed tasks.
   */
  async archiveOldTasks(olderThanDays = 30): Promise<number> {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - olderThanDays)

    const result = await db
      .updateTable('task')
      .set({
        status: 'archived',
        archived_at: new Date(),
      })
      .where('status', '=', 'completed')
      .where('completed_at', '<', cutoff)
      .execute()

    return Number(result[0].numUpdatedRows)
  }

  /**
   * Get task statistics.
   */
  async getTaskStats(): Promise<{
    pending: number
    in_progress: number
    completed_today: number
    completed_week: number
    overdue: number
    by_source: { user: number; agent: number }
  }> {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const weekAgo = new Date(today)
    weekAgo.setDate(weekAgo.getDate() - 7)

    const [
      pending,
      inProgress,
      completedToday,
      completedWeek,
      overdue,
      userTasks,
      agentTasks,
    ] = await Promise.all([
      db
        .selectFrom('task')
        .select(db.fn.countAll().as('count'))
        .where('status', '=', 'pending')
        .executeTakeFirst(),
      db
        .selectFrom('task')
        .select(db.fn.countAll().as('count'))
        .where('status', '=', 'in_progress')
        .executeTakeFirst(),
      db
        .selectFrom('task')
        .select(db.fn.countAll().as('count'))
        .where('status', '=', 'completed')
        .where('completed_at', '>=', today)
        .executeTakeFirst(),
      db
        .selectFrom('task')
        .select(db.fn.countAll().as('count'))
        .where('status', '=', 'completed')
        .where('completed_at', '>=', weekAgo)
        .executeTakeFirst(),
      db
        .selectFrom('task')
        .select(db.fn.countAll().as('count'))
        .where('status', 'in', ['pending', 'in_progress'])
        .where('due_date', '<', today)
        .executeTakeFirst(),
      db
        .selectFrom('task')
        .select(db.fn.countAll().as('count'))
        .where('source', '=', 'user')
        .where('status', 'in', ['pending', 'in_progress'])
        .executeTakeFirst(),
      db
        .selectFrom('task')
        .select(db.fn.countAll().as('count'))
        .where('source', '=', 'agent')
        .where('status', 'in', ['pending', 'in_progress'])
        .executeTakeFirst(),
    ])

    return {
      pending: Number(pending?.count || 0),
      in_progress: Number(inProgress?.count || 0),
      completed_today: Number(completedToday?.count || 0),
      completed_week: Number(completedWeek?.count || 0),
      overdue: Number(overdue?.count || 0),
      by_source: {
        user: Number(userTasks?.count || 0),
        agent: Number(agentTasks?.count || 0),
      },
    }
  }
}

export const taskService = new TaskService()
