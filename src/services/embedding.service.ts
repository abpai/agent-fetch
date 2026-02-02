import OpenAI from 'openai'
import { sql } from 'kysely'

import { env } from '../config/environment.js'
import { db } from '../db/index.js'

const BATCH_SIZE = 100
const EMBEDDING_MODEL = 'text-embedding-ada-002'

class EmbeddingService {
  private client: OpenAI | null = null

  private getClient(): OpenAI {
    if (!this.client) {
      if (!env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not set')
      }
      this.client = new OpenAI({ apiKey: env.OPENAI_API_KEY })
    }
    return this.client
  }

  /**
   * Generate embeddings for an array of texts
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return []

    const client = this.getClient()
    const response = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: texts,
    })

    return response.data.map((d) => d.embedding)
  }

  /**
   * Generate embeddings for all chunks of a document that don't have embeddings yet
   */
  async embedChunksForDocument(docId: number): Promise<number> {
    // Get chunks without embeddings
    const chunks = await db
      .selectFrom('chunk')
      .select(['chunk_id', 'text'])
      .where('doc_id', '=', docId)
      .where('embedding', 'is', null)
      .orderBy('chunk_index')
      .execute()

    if (chunks.length === 0) return 0

    let embedded = 0

    // Process in batches
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE)
      const texts = batch.map((c) => c.text)

      try {
        const embeddings = await this.embed(texts)

        // Update each chunk with its embedding
        for (let j = 0; j < batch.length; j++) {
          const chunk = batch[j]
          const embedding = embeddings[j]

          // Use raw SQL to set the vector type properly
          await sql`
            UPDATE chunk
            SET embedding = ${JSON.stringify(embedding)}::vector
            WHERE chunk_id = ${chunk.chunk_id}
          `.execute(db)

          embedded++
        }
      } catch (error) {
        console.error(`Failed to embed batch starting at ${i}:`, error)
        throw error
      }
    }

    return embedded
  }

  /**
   * Embed a single query for search
   */
  async embedQuery(query: string): Promise<number[]> {
    const embeddings = await this.embed([query])
    return embeddings[0]
  }

  /**
   * Search for similar chunks using vector similarity
   */
  async searchSimilar(
    queryEmbedding: number[],
    limit: number = 10,
    filters?: {
      domains?: string[]
      startDate?: Date
      endDate?: Date
    },
  ): Promise<
    Array<{
      chunk_id: number
      doc_id: number
      text: string
      heading: string | null
      score: number
      title: string | null
      url: string
      visited_at: Date[]
    }>
  > {
    // Build the query with optional filters
    let query = sql`
      SELECT
        c.chunk_id,
        c.doc_id,
        c.text,
        c.heading,
        1 - (c.embedding <=> ${JSON.stringify(queryEmbedding)}::vector) as score,
        d.title,
        u.url_norm as url,
        ARRAY_AGG(v.visited_at ORDER BY v.visited_at DESC) as visited_at
      FROM chunk c
      JOIN document d ON c.doc_id = d.doc_id
      JOIN url u ON d.url_id = u.url_id
      LEFT JOIN visit v ON u.url_id = v.url_id
      WHERE c.embedding IS NOT NULL
    `

    if (filters?.domains && filters.domains.length > 0) {
      query = sql`${query} AND u.domain = ANY(${filters.domains})`
    }

    if (filters?.startDate) {
      query = sql`${query} AND v.visited_at >= ${filters.startDate}`
    }

    if (filters?.endDate) {
      query = sql`${query} AND v.visited_at <= ${filters.endDate}`
    }

    query = sql`
      ${query}
      GROUP BY c.chunk_id, c.doc_id, c.text, c.heading, c.embedding, d.title, u.url_norm
      ORDER BY score DESC
      LIMIT ${limit}
    `

    const result = await query.execute(db)

    return result.rows as Array<{
      chunk_id: number
      doc_id: number
      text: string
      heading: string | null
      score: number
      title: string | null
      url: string
      visited_at: Date[]
    }>
  }

  /**
   * Backfill embeddings for all chunks that don't have them
   */
  async backfillEmbeddings(): Promise<{ processed: number; total: number }> {
    // Get count of chunks without embeddings
    const countResult = await db
      .selectFrom('chunk')
      .select(db.fn.count('chunk_id').as('count'))
      .where('embedding', 'is', null)
      .executeTakeFirst()

    const total = Number(countResult?.count || 0)

    if (total === 0) {
      return { processed: 0, total: 0 }
    }

    // Get unique doc_ids that have chunks without embeddings
    const docs = await db
      .selectFrom('chunk')
      .select('doc_id')
      .where('embedding', 'is', null)
      .groupBy('doc_id')
      .execute()

    let processed = 0

    for (const doc of docs) {
      const count = await this.embedChunksForDocument(doc.doc_id)
      processed += count
      console.log(`Embedded ${count} chunks for document ${doc.doc_id}`)
    }

    return { processed, total }
  }
}

export const embeddingService = new EmbeddingService()
