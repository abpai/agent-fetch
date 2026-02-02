#!/usr/bin/env tsx
import { Command } from 'commander'
import { crawlerService } from './services/crawler.service'
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const program = new Command()
program
  .command('add')
  .description('Add URLs to the task queue')
  .argument('<urls...>', 'URLs to crawl')
  .action(async (urls: string[]) => {
    console.log(`Adding ${urls.length} URLs to the queue...`)
    await crawlerService.addUrls(urls)
    console.log('URLs added successfully.')
    process.exit(0)
  })

program
  .command('ingest')
  .description('Ingest URLs from a JSON file')
  .argument('<file>', 'JSON file containing list of URLs')
  .option('-l, --limit <number>', 'Limit the number of URLs to ingest', parseInt)
  .action(async (file, options) => {
    const filePath = path.resolve(process.cwd(), file)
    if (!fs.existsSync(filePath)) {
      console.error(`❌ File not found: ${filePath}`)
      process.exit(1)
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content)

      let urls: string[] = []

      if (Array.isArray(data)) {
        // Handle array of strings or objects with url property
        urls = data
          .map((item: any) => (typeof item === 'string' ? item : item.url))
          .filter(Boolean)
      }

      if (options.limit && options.limit > 0) {
        urls = urls.slice(0, options.limit)
        console.log(`⚠️ Limiting to top ${options.limit} URLs.`)
      }

      console.log(`🚀 Ingesting ${urls.length} URLs...`)

      const chunkSize = 100
      for (let i = 0; i < urls.length; i += chunkSize) {
        const chunk = urls.slice(i, i + chunkSize)
        await crawlerService.addUrls(chunk)
        process.stdout.write(
          `\r✅ Added ${Math.min(i + chunkSize, urls.length)}/${urls.length} URLs`,
        )
      }
      console.log('\n🏁 Ingestion complete.')
    } catch (err: any) {
      console.error('❌ Error reading file:', err.message)
    }
    process.exit(0)
  })
program
  .command('stats')
  .description('Show queue statistics')
  .action(async () => {
    const storagePath = crawlerService.getStoragePath()
    const dbPath = path.join(storagePath, 'request_queues', 'default', 'db.sqlite')

    if (!fs.existsSync(dbPath)) {
      console.log('No queue database found.')
      process.exit(0)
    }

    const db = new Database(dbPath, { readonly: true })
    try {
      const stats = db
        .prepare(
          `
        SELECT 
            COUNT(*) as total,
            SUM(CASE WHEN json LIKE '%"handledAt":%' THEN 1 ELSE 0 END) as handled
        FROM request_queues_requests
      `,
        )
        .get() as { total: number; handled: number }

      console.log('Queue Stats (Direct SQL):')
      console.log(`  Total: ${stats.total}`)
      console.log(`  Handled: ${stats.handled || 0}`)
      console.log(`  Pending: ${stats.total - (stats.handled || 0)}`)
    } finally {
      db.close()
    }
    process.exit(0)
  })

program.parse()
