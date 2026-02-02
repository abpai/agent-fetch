import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

import { ApifyStorageLocal } from '@apify/storage-local'
import { Readability } from '@mozilla/readability'
import { Configuration, PlaywrightCrawler, RequestQueue } from 'crawlee'
import { JSDOM } from 'jsdom'
import TurndownService from 'turndown'

import { db } from '../db/index.js'

import { chunkerService } from './chunker.service.js'
import { embeddingService } from './embedding.service.js'

export class CrawlerService {
  private storage: ApifyStorageLocal
  private turndownService: TurndownService
  private storageDir: string

  constructor() {
    this.storageDir = path.resolve(process.cwd(), 'storage')
    this.storage = new ApifyStorageLocal({
      storageDir: this.storageDir,
      enableWalMode: true,
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Configuration.getGlobalConfig().useStorageClient(this.storage as any)

    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    })

    // Ensure storage directories exist
    fs.mkdirSync(path.join(this.storageDir, 'html'), { recursive: true })
    fs.mkdirSync(path.join(this.storageDir, 'md'), { recursive: true })
  }

  async getRequestQueue() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await RequestQueue.open('default', { storageClient: this.storage as any })
  }

  async addUrls(urls: string[]) {
    const queue = await this.getRequestQueue()
    for (const url of urls) {
      await queue.addRequest({ url })
    }
  }

  async run() {
    const crawler = new PlaywrightCrawler({
      // @ts-expect-error - storageClient is a valid option but types are outdated
      storageClient: this.storage,
      requestHandler: async ({ request, page, log }) => {
        const pageTitle = await page.title()
        log.info(`Crawled: ${request.url} | Title: ${pageTitle}`)

        const rawHtml = await page.content()
        let markdown = ''
        let extractedTitle = pageTitle
        let author: string | null = null

        try {
          const dom = new JSDOM(rawHtml, { url: request.url })
          const reader = new Readability(dom.window.document)
          const article = reader.parse()

          if (article) {
            extractedTitle = article.title || pageTitle
            author = article.byline || null
            markdown = this.turndownService.turndown(article.content || '')
          } else {
            markdown = this.turndownService.turndown(rawHtml)
          }
        } catch (error) {
          log.error(`Failed to parse content for ${request.url}: ${error}`)
          markdown = ''
        }

        // Compute content hash for deduplication
        const contentHash = crypto
          .createHash('sha256')
          .update(markdown)
          .digest('hex')
          .slice(0, 16)

        // Store files with content-addressable keys
        const htmlKey = `html/${contentHash}.html`
        const mdKey = `md/${contentHash}.md`

        fs.writeFileSync(path.join(this.storageDir, htmlKey), rawHtml)
        fs.writeFileSync(path.join(this.storageDir, mdKey), markdown)

        // Find or create URL record
        let urlRecord = await db
          .selectFrom('url')
          .select(['url_id'])
          .where('url_norm', '=', request.url)
          .executeTakeFirst()

        if (!urlRecord) {
          const urlObj = new URL(request.url)
          const domain = urlObj.hostname.replace(/^www\./, '')
          const urlPath = urlObj.pathname

          urlRecord = await db
            .insertInto('url')
            .values({
              url_norm: request.url,
              domain,
              path: urlPath,
            })
            .returning('url_id')
            .executeTakeFirstOrThrow()
        }

        // Check if document already exists
        const existingDoc = await db
          .selectFrom('document')
          .select('doc_id')
          .where('url_id', '=', urlRecord.url_id)
          .executeTakeFirst()

        let docId: number

        if (existingDoc) {
          // Update existing document
          await db
            .updateTable('document')
            .set({
              content_hash: contentHash,
              title: extractedTitle,
              author,
              fetched_at: new Date(),
              status: 'ok',
              text_length: markdown.length,
              html_key: htmlKey,
              markdown_key: mdKey,
            })
            .where('doc_id', '=', existingDoc.doc_id)
            .execute()
          docId = existingDoc.doc_id

          // Delete old chunks before re-chunking
          await db.deleteFrom('chunk').where('doc_id', '=', docId).execute()
        } else {
          // Insert new document
          const result = await db
            .insertInto('document')
            .values({
              url_id: urlRecord.url_id,
              content_hash: contentHash,
              title: extractedTitle,
              author,
              status: 'ok',
              text_length: markdown.length,
              html_key: htmlKey,
              markdown_key: mdKey,
            })
            .returning('doc_id')
            .executeTakeFirstOrThrow()
          docId = result.doc_id
        }

        // Chunk the document
        if (markdown.length > 0) {
          const chunks = chunkerService.chunkMarkdown(markdown, extractedTitle)
          await chunkerService.saveChunks(docId, chunks)

          // Generate embeddings for chunks
          await embeddingService.embedChunksForDocument(docId)
        }

        log.info(`Saved document ${docId} with ${markdown.length} chars`)
      },
      maxRequestsPerCrawl: 50,
    })

    await crawler.run()
  }

  getStoragePath() {
    return this.storageDir
  }
}

export const crawlerService = new CrawlerService()
