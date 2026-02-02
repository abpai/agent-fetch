import { Type } from '@sinclair/typebox'

import { searchService } from '../../services/search.service.js'

import type { FastifyPluginAsync } from 'fastify'

const SearchQuerySchema = Type.Object({
  query: Type.String(),
  mode: Type.Optional(
    Type.Union([
      Type.Literal('semantic'),
      Type.Literal('keyword'),
      Type.Literal('hybrid'),
    ]),
  ),
  time_range: Type.Optional(
    Type.Object({
      start: Type.String(),
      end: Type.String(),
    }),
  ),
  domains: Type.Optional(Type.Array(Type.String())),
  limit: Type.Optional(Type.Number()),
})

const GetDocumentParamsSchema = Type.Object({
  doc_id: Type.Number(),
})

const GetDocumentQuerySchema = Type.Object({
  include_chunks: Type.Optional(Type.Boolean()),
  chunk_start: Type.Optional(Type.Number()),
  chunk_end: Type.Optional(Type.Number()),
})

const WeeklyRecapQuerySchema = Type.Object({
  week_of: Type.String(),
})

export const memoryRoutes: FastifyPluginAsync = async (fastify) => {
  // Search memory
  fastify.post('/search', {
    schema: {
      description: 'Search your web browsing memory',
      tags: ['memory'],
      body: SearchQuerySchema,
    },
    handler: async (request, _reply) => {
      const params = request.body as {
        query: string
        mode?: 'semantic' | 'keyword' | 'hybrid'
        time_range?: { start: string; end: string }
        domains?: string[]
        limit?: number
      }

      const results = await searchService.search({
        query: params.query,
        mode: params.mode || 'hybrid',
        timeRange: params.time_range,
        domains: params.domains,
        limit: params.limit,
      })

      return results
    },
  })

  // Get document by ID
  fastify.get<{
    Params: { doc_id: number }
    Querystring: { include_chunks?: boolean; chunk_start?: number; chunk_end?: number }
  }>('/documents/:doc_id', {
    schema: {
      description: 'Get a document by ID with optional chunks',
      tags: ['memory'],
      params: GetDocumentParamsSchema,
      querystring: GetDocumentQuerySchema,
    },
    handler: async (request, reply) => {
      const { doc_id } = request.params
      const { include_chunks, chunk_start, chunk_end } = request.query

      const chunkRange =
        chunk_start !== undefined && chunk_end !== undefined
          ? { start: chunk_start, end: chunk_end }
          : undefined

      const doc = await searchService.getDocument(doc_id, include_chunks, chunkRange)

      if (!doc) {
        return reply.status(404).send({ error: 'Document not found' })
      }

      return doc
    },
  })

  // Weekly recap
  fastify.get('/recap', {
    schema: {
      description: 'Get a weekly recap of browsing activity',
      tags: ['memory'],
      querystring: WeeklyRecapQuerySchema,
    },
    handler: async (request, _reply) => {
      const { week_of } = request.query as { week_of: string }
      const recap = await searchService.getWeeklyRecap(week_of)
      return recap
    },
  })
}
