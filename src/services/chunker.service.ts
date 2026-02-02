import { db } from '../db/index.js'

export interface ChunkData {
  text: string
  heading: string | null
  chunkType: 'heading' | 'paragraph' | 'code' | 'list'
  charStart: number
  charEnd: number
}

const TARGET_TOKENS = 500
const MAX_TOKENS = 700
const CHARS_PER_TOKEN = 4 // rough estimate

class ChunkerService {
  /**
   * Split markdown into chunks of approximately TARGET_TOKENS tokens.
   * Tries to respect heading boundaries and paragraph breaks.
   */
  chunkMarkdown(markdown: string, title: string): ChunkData[] {
    const chunks: ChunkData[] = []
    const lines = markdown.split('\n')

    let currentChunk: string[] = []
    let currentHeading: string | null = title || null
    let currentType: ChunkData['chunkType'] = 'paragraph'
    let chunkStart = 0
    let currentPos = 0

    const flushChunk = () => {
      const text = currentChunk.join('\n').trim()
      if (text.length > 0) {
        chunks.push({
          text,
          heading: currentHeading,
          chunkType: currentType,
          charStart: chunkStart,
          charEnd: currentPos,
        })
      }
      currentChunk = []
      chunkStart = currentPos
    }

    const estimateTokens = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN)

    for (const line of lines) {
      const lineLength = line.length + 1 // +1 for newline

      // Check if this is a heading
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)

      if (headingMatch) {
        // Flush current chunk before starting new section
        flushChunk()
        currentHeading = headingMatch[2].trim()
        currentType = 'heading'
        currentChunk.push(line)
        currentPos += lineLength
        continue
      }

      // Check if this is a code block marker
      if (line.startsWith('```')) {
        if (currentType === 'code') {
          // End of code block
          currentChunk.push(line)
          currentPos += lineLength
          currentType = 'paragraph'

          // If chunk is getting large, flush
          if (estimateTokens(currentChunk.join('\n')) >= TARGET_TOKENS) {
            flushChunk()
          }
          continue
        } else {
          // Start of code block - flush first if needed
          if (estimateTokens(currentChunk.join('\n')) >= TARGET_TOKENS) {
            flushChunk()
          }
          currentType = 'code'
          currentChunk.push(line)
          currentPos += lineLength
          continue
        }
      }

      // Check if this is a list item
      const isListItem = /^[\s]*[-*+]\s/.test(line) || /^[\s]*\d+\.\s/.test(line)

      if (isListItem && currentType !== 'list' && currentType !== 'code') {
        // Starting a list
        if (estimateTokens(currentChunk.join('\n')) >= TARGET_TOKENS) {
          flushChunk()
        }
        currentType = 'list'
      } else if (!isListItem && currentType === 'list' && line.trim() === '') {
        // End of list (blank line after list items)
        currentType = 'paragraph'
      }

      // Add line to current chunk
      currentChunk.push(line)
      currentPos += lineLength

      // Check if we should split (but not in the middle of code blocks)
      if (currentType !== 'code') {
        const currentTokens = estimateTokens(currentChunk.join('\n'))

        if (currentTokens >= MAX_TOKENS) {
          // Force split at a paragraph boundary
          flushChunk()
          currentType = 'paragraph'
        } else if (currentTokens >= TARGET_TOKENS && line.trim() === '') {
          // Good natural break point
          flushChunk()
          currentType = 'paragraph'
        }
      }
    }

    // Flush remaining content
    flushChunk()

    return chunks
  }

  /**
   * Save chunks to the database
   */
  async saveChunks(docId: number, chunks: ChunkData[]): Promise<void> {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const tokenCount = Math.ceil(chunk.text.length / CHARS_PER_TOKEN)

      await db
        .insertInto('chunk')
        .values({
          doc_id: docId,
          chunk_index: i,
          chunk_type: chunk.chunkType,
          heading: chunk.heading,
          text: chunk.text,
          token_count: tokenCount,
          char_start: chunk.charStart,
          char_end: chunk.charEnd,
        })
        .execute()
    }
  }

  /**
   * Get chunks for a document
   */
  async getChunks(docId: number): Promise<Array<{ chunk_id: number; text: string }>> {
    return await db
      .selectFrom('chunk')
      .select(['chunk_id', 'text'])
      .where('doc_id', '=', docId)
      .orderBy('chunk_index')
      .execute()
  }
}

export const chunkerService = new ChunkerService()
