import { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import { crawlerService } from '@/services/crawler.service'
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const RunCrawlerSchema = Type.Object({
  urls: Type.Optional(Type.Array(Type.String({ format: 'uri' }))),
})

export default async function (fastify: FastifyInstance) {
  // Trigger a crawl
  fastify.post(
    '/run',
    {
      schema: {
        summary: 'Run the crawler',
        description:
          'Starts the crawl process. If URLs are provided, they are added to the queue first.',
        body: RunCrawlerSchema,
        response: {
          202: Type.Object({ message: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const { urls } = request.body as { urls?: string[] }

      if (urls && urls.length > 0) {
        await crawlerService.addUrls(urls)
      }

      // Run in background
      crawlerService.run().catch((err) => {
        fastify.log.error(err, 'Crawler background error')
      })

      return reply.status(202).send({ message: 'Crawler started in background' })
    },
  )

  // Simple Dashboard / Stats
  fastify.get(
    '/stats',
    {
      schema: {
        summary: 'Get crawler stats',
        description: 'Retrieves stats from the crawler SQLite database',
        response: {
          200: Type.Object({
            pending: Type.Number(),
            completed: Type.Number(),
            running: Type.Array(Type.String()),
          }),
        },
      },
    },
    async (_request, _reply) => {
      const storagePath = crawlerService.getStoragePath()
      const dbPath = path.join(storagePath, 'request_queues', 'default', 'db.sqlite')

      if (!fs.existsSync(dbPath)) {
        return {
          pending: 0,
          completed: 0,
          running: [],
        }
      }

      const sqliteDb = new Database(dbPath, { readonly: true })
      try {
        const stats = sqliteDb
          .prepare(
            `
          SELECT
              SUM(CASE WHEN orderNo IS NOT NULL THEN 1 ELSE 0 END) as pending,
              SUM(CASE WHEN json LIKE '%"handledAt":%' THEN 1 ELSE 0 END) as completed
          FROM request_queue_entries
        `,
          )
          .get() as { pending: number; completed: number }

        const runningRows = sqliteDb
          .prepare(
            `
          SELECT json FROM request_queue_entries
          WHERE json NOT LIKE '%"handledAt":%'
          ORDER BY orderNo ASC
          LIMIT 5
        `,
          )
          .all() as { json: string }[]

        const running = runningRows.map((row) => JSON.parse(row.json).url)

        return {
          pending: stats.pending || 0,
          completed: stats.completed || 0,
          running,
        }
      } finally {
        sqliteDb.close()
      }
    },
  )

  // HTML Dashboard for easy viewing
  fastify.get(
    '/dashboard',
    {
      schema: {
        hide: true, // Hide from swagger if you want
      },
    },
    async (request, reply) => {
      const storagePath = crawlerService.getStoragePath()
      const dbPath = path.join(storagePath, 'request_queues', 'default', 'db.sqlite')

      let stats = { pending: 0, completed: 0 }
      let running: string[] = []

      if (fs.existsSync(dbPath)) {
        const db = new Database(dbPath, { readonly: true })
        try {
          stats = db
            .prepare(
              `
            SELECT 
                SUM(CASE WHEN orderNo IS NOT NULL THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN json LIKE '%"handledAt":%' THEN 1 ELSE 0 END) as completed
            FROM request_queue_entries
          `,
            )
            .get() as { pending: number; completed: number }

          const runningRows = db
            .prepare(
              `
            SELECT json FROM request_queue_entries 
            WHERE json NOT LIKE '%"handledAt":%' 
            ORDER BY orderNo ASC 
            LIMIT 5
          `,
            )
            .all() as { json: string }[]

          running = runningRows.map((row) => JSON.parse(row.json).url)
        } finally {
          db.close()
        }
      }

      reply.type('text/html').send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Crawler Status</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 2rem; background: #f4f4f9; color: #333; }
            .card { background: white; padding: 1.5rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); max-width: 600px; margin: 0 auto; }
            h1 { color: #2c3e50; }
            .stat { font-size: 1.2rem; margin: 0.5rem 0; }
            .stat strong { color: #3498db; }
            ul { list-style: none; padding: 0; }
            li { background: #eef2f3; padding: 0.5rem; margin: 0.3rem 0; border-radius: 4px; font-size: 0.9rem; word-break: break-all; }
            .refresh { font-size: 0.8rem; color: #888; margin-top: 1rem; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>Crawler Status</h1>
            <div class="stat"><strong>Pending:</strong> ${stats.pending || 0}</div>
            <div class="stat"><strong>Completed:</strong> ${stats.completed || 0}</div>
            <h3>Processing Now:</h3>
            <ul>
              ${running.length > 0 ? running.map((url) => `<li>${url}</li>`).join('') : '<li>None</li>'}
            </ul>
            <div class="refresh">Auto-refreshing every 2 seconds...</div>
          </div>
          <script>setTimeout(() => window.location.reload(), 2000)</script>
        </body>
        </html>
      `)
    },
  )
}
