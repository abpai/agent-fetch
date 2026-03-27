import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import TurndownService from 'turndown'
import type { FetchResult, FetchStrategy } from './types.js'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
})

export const countWords = (markdown: string): number => markdown.split(/\s+/).filter(Boolean).length

export const extractFromHtml = (url: string, html: string, strategy: FetchStrategy): FetchResult => {
  let title = ''
  let author: string | null = null
  let markdown = ''
  let dom: JSDOM | null = null

  try {
    dom = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    title = article?.title || dom.window.document.title || ''
    author = article?.byline || null
    markdown = article?.content ? turndown.turndown(article.content) : turndown.turndown(html)
  } catch {
    markdown = turndown.turndown(html)
  } finally {
    dom?.window.close()
  }

  return {
    url,
    title,
    author,
    markdown,
    html,
    wordCount: countWords(markdown),
    fetchedAt: new Date(),
    strategy,
    attempts: [],
  }
}
