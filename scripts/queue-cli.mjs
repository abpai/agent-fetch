#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_QUEUE_PATH = path.resolve(process.cwd(), 'data/url_queue.json')

function printUsage() {
  console.log(`Queue CLI

Usage:
  node scripts/queue-cli.mjs stats [queueFile]
  node scripts/queue-cli.mjs list [limit] [queueFile]
  node scripts/queue-cli.mjs peek [count] [queueFile]
  node scripts/queue-cli.mjs pop [count] [queueFile]
  node scripts/queue-cli.mjs remove <url> [queueFile]
  node scripts/queue-cli.mjs enqueue <url> [title] [queueFile]

Examples:
  node scripts/queue-cli.mjs stats
  node scripts/queue-cli.mjs list 25
  node scripts/queue-cli.mjs pop 10
  node scripts/queue-cli.mjs remove https://example.com/article
  node scripts/queue-cli.mjs enqueue https://example.com/post "Manual URL"
`)
}

function parseQueuePath(args, index) {
  const maybePath = args[index]
  return maybePath ? path.resolve(process.cwd(), maybePath) : DEFAULT_QUEUE_PATH
}

function parseCountAndQueuePath(args, countIndex, queuePathIndex, fallbackCount) {
  const countOrPath = args[countIndex]
  if (countOrPath === undefined) {
    return {
      count: fallbackCount,
      queuePath: parseQueuePath(args, queuePathIndex),
    }
  }

  const isCountToken = /^-?\d+$/.test(countOrPath)
  if (isCountToken) {
    const parsed = Number.parseInt(countOrPath, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Count must be a positive integer. Received: ${countOrPath}`)
    }

    return {
      count: parsed,
      queuePath: parseQueuePath(args, queuePathIndex),
    }
  }

  return {
    count: fallbackCount,
    queuePath: path.resolve(process.cwd(), countOrPath),
  }
}

function ensureQueueFile(queuePath) {
  if (fs.existsSync(queuePath)) return

  fs.mkdirSync(path.dirname(queuePath), { recursive: true })
  const initial = { stats: { unique_kept: 0 }, urls: [] }
  fs.writeFileSync(queuePath, JSON.stringify(initial, null, 2))
}

function loadQueue(queuePath) {
  ensureQueueFile(queuePath)
  const parsed = JSON.parse(fs.readFileSync(queuePath, 'utf-8'))
  if (!Array.isArray(parsed.urls)) {
    throw new Error(`Invalid queue file: ${queuePath}. Expected "urls" array.`)
  }
  if (!parsed.stats || typeof parsed.stats !== 'object') {
    parsed.stats = {}
  }
  return parsed
}

function saveQueue(queuePath, data) {
  data.stats.unique_kept = data.urls.length
  data.stats.queue_remaining = data.urls.length
  fs.writeFileSync(queuePath, JSON.stringify(data, null, 2))
}

function toRow(item, index) {
  return {
    index: index + 1,
    count: item.count ?? 1,
    date: item.lastVisit ? new Date(item.lastVisit).toISOString().slice(0, 10) : '',
    title: item.title ?? '',
    url: item.url,
  }
}

function printList(items) {
  if (items.length === 0) {
    console.log('Queue is empty.')
    return
  }
  console.table(items.map(toRow))
}

function ensureValidUrl(value) {
  try {
    return new URL(value).toString()
  } catch {
    throw new Error(`Invalid URL: ${value}`)
  }
}

function run() {
  const args = process.argv.slice(2)
  const command = args[0]
  if (!command || command === '--help' || command === '-h') {
    printUsage()
    process.exit(0)
  }

  if (command === 'stats') {
    const queuePath = parseQueuePath(args, 1)
    const data = loadQueue(queuePath)
    const queueSize = data.urls.length
    const stats = {
      queue_file: queuePath,
      queue_size: queueSize,
      total_items: data.stats.total_items ?? null,
      blocked_items: data.stats.blocked_items ?? null,
      unique_kept: data.stats.unique_kept ?? queueSize,
    }
    console.table([stats])
    return
  }

  if (command === 'list') {
    const { count: limit, queuePath } = parseCountAndQueuePath(args, 1, 2, 20)
    const data = loadQueue(queuePath)
    printList(data.urls.slice(0, limit))
    return
  }

  if (command === 'peek') {
    const { count, queuePath } = parseCountAndQueuePath(args, 1, 2, 1)
    const data = loadQueue(queuePath)
    printList(data.urls.slice(0, count))
    return
  }

  if (command === 'pop') {
    const { count, queuePath } = parseCountAndQueuePath(args, 1, 2, 1)
    const data = loadQueue(queuePath)
    const popped = data.urls.splice(0, count)
    saveQueue(queuePath, data)
    console.log(`Popped ${popped.length} URL(s). Remaining: ${data.urls.length}`)
    printList(popped)
    return
  }

  if (command === 'remove') {
    const rawUrl = args[1]
    if (!rawUrl) {
      throw new Error('Missing URL. Usage: remove <url> [queueFile]')
    }
    const normalized = ensureValidUrl(rawUrl)
    const queuePath = parseQueuePath(args, 2)
    const data = loadQueue(queuePath)
    const before = data.urls.length
    data.urls = data.urls.filter((entry) => entry.url !== normalized)
    const removed = before - data.urls.length
    saveQueue(queuePath, data)
    console.log(`Removed ${removed} URL(s). Remaining: ${data.urls.length}`)
    return
  }

  if (command === 'enqueue') {
    const rawUrl = args[1]
    if (!rawUrl) {
      throw new Error('Missing URL. Usage: enqueue <url> [title] [queueFile]')
    }
    const normalized = ensureValidUrl(rawUrl)
    const title = args[2] ?? ''
    const queuePath = parseQueuePath(args, 3)
    const data = loadQueue(queuePath)

    if (data.urls.some((entry) => entry.url === normalized)) {
      console.log('URL already exists in queue. No change made.')
      return
    }

    data.urls.push({
      url: normalized,
      count: 1,
      lastVisit: Date.now(),
      title,
    })
    saveQueue(queuePath, data)
    console.log(`Enqueued URL. Queue size: ${data.urls.length}`)
    return
  }

  throw new Error(`Unknown command: ${command}`)
}

try {
  run()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
