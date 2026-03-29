import { Readability } from '@mozilla/readability'
import { extractBytes, initWasm } from '@kreuzberg/wasm'
import { JSDOM } from 'jsdom'
import TurndownService from 'turndown'
import type {
  FetchResult,
  FetchStrategy,
  OutputMode,
  StructuredContent,
  StructuredHeading,
  StructuredLink,
  StructuredSection,
} from './types'

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
})

const encoder = new TextEncoder()

const FOOTER_BOILERPLATE_PATTERNS = [
  /risk disclosure/i,
  /fusion media/i,
  /all rights reserved/i,
  /terms and conditions/i,
  /privacy policy/i,
]

const NOISY_SELECTORS = [
  'script',
  'style',
  'noscript',
  'svg',
  'img',
  'picture',
  'source',
  'form',
  'button',
  'iframe',
  'canvas',
  'header',
  'footer',
  'nav',
  'aside',
  '[hidden]',
  '[aria-hidden="true"]',
  '[role="banner"]',
  '[role="navigation"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
  '[role="search"]',
  '[role="dialog"]',
]

const CONTENT_ROOT_SELECTORS = ['main', '[role="main"]', 'article', 'body']
const PRUNABLE_NODE_SELECTORS = ['a', 'span', 'div', 'p', 'section', 'article', 'li']

let kreuzbergInitPromise: Promise<void> | null = null

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim()

const stripMarkdownInline = (value: string): string =>
  normalizeWhitespace(
    value.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[`*_~]/g, ''),
  )

const countWords = (value: string): number =>
  normalizeWhitespace(value).split(/\s+/).filter(Boolean).length

const getMetaValue = (document: Document, selectors: string[]): string => {
  for (const selector of selectors) {
    const content = document.querySelector(selector)?.getAttribute('content')
    const normalized = normalizeWhitespace(content ?? '')
    if (normalized) {
      return normalized
    }
  }

  return ''
}

const getMetaDescription = (document: Document): string =>
  getMetaValue(document, [
    'meta[name="description"]',
    'meta[property="og:description"]',
    'meta[name="twitter:description"]',
  ])

const getMetaAuthor = (document: Document): string | null => {
  const author = getMetaValue(document, [
    'meta[name="author"]',
    'meta[property="article:author"]',
  ])

  return author || null
}

const looksLikeFooterBoilerplate = (value: string): boolean => {
  const normalized = normalizeWhitespace(value)
  if (!normalized) {
    return false
  }

  const matches = FOOTER_BOILERPLATE_PATTERNS.filter((pattern) =>
    pattern.test(normalized),
  ).length

  return matches >= 2
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const hasMeaningfulText = (value: string, minimumLength = 1): boolean =>
  normalizeWhitespace(value).length >= minimumLength

const pruneEmptyNodes = (document: Document): void => {
  const elements = Array.from(
    document.querySelectorAll(PRUNABLE_NODE_SELECTORS.join(',')),
  ).reverse()

  for (const element of elements) {
    if (element.children.length > 0) {
      continue
    }

    if (!hasMeaningfulText(element.textContent ?? '')) {
      element.remove()
    }
  }
}

const removeNoisyElements = (document: Document): void => {
  for (const selector of NOISY_SELECTORS) {
    document.querySelectorAll(selector).forEach((element) => element.remove())
  }
}

const pickContentRoot = (document: Document): Element => {
  for (const selector of CONTENT_ROOT_SELECTORS) {
    const candidate = document.querySelector(selector)
    if (candidate && hasMeaningfulText(candidate.textContent ?? '', 120)) {
      return candidate
    }
  }

  return document.body
}

const buildCleanedHtml = (
  url: string,
  html: string,
): { title: string; description: string; html: string } => {
  const dom = new JSDOM(html, { url })

  try {
    const { document } = dom.window
    removeNoisyElements(document)
    pruneEmptyNodes(document)

    const root = pickContentRoot(document)
    const title = normalizeWhitespace(document.title)
    const description = getMetaDescription(document)
    const descriptionMetaTag = description
      ? `<meta name="description" content="${escapeHtml(description)}" />`
      : ''

    return {
      title,
      description,
      html: `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>${escapeHtml(
        title,
      )}</title>${descriptionMetaTag}</head><body>${root.innerHTML}</body></html>`,
    }
  } finally {
    dom.window.close()
  }
}

const ensureKreuzbergInitialized = async (): Promise<void> => {
  if (!kreuzbergInitPromise) {
    kreuzbergInitPromise = initWasm().catch((error) => {
      kreuzbergInitPromise = null
      throw error
    })
  }

  await kreuzbergInitPromise
}

const convertHtmlToMarkdown = async (html: string): Promise<string> => {
  await ensureKreuzbergInitialized()

  const result = await extractBytes(encoder.encode(html), 'text/html', {
    outputFormat: 'markdown',
    htmlOptions: {
      wrap: false,
    },
  })

  return result.content.trim()
}

const extractPrimaryMarkdown = (
  document: Document,
  fallbackDescription: string,
): { title: string; author: string | null; markdown: string } => {
  const article = new Readability(document).parse()
  const title = article?.title || document.title || ''
  const author = article?.byline || getMetaAuthor(document)
  let markdown = article?.content ? turndown.turndown(article.content).trim() : ''

  if ((!markdown || looksLikeFooterBoilerplate(markdown)) && fallbackDescription) {
    markdown = fallbackDescription
  }

  return {
    title: normalizeWhitespace(title),
    author,
    markdown,
  }
}

const normalizeHref = (href: string, url: string): string => {
  try {
    return new URL(href, url).toString()
  } catch {
    return href
  }
}

const flushCurrentSection = (
  currentSection: StructuredSection | null,
  sections: StructuredSection[],
): void => {
  if (!currentSection) {
    return
  }

  currentSection.content = currentSection.content.trim()
  sections.push(currentSection)
}

const collectStructuredLinks = (markdown: string, url: string): StructuredLink[] => {
  const links: StructuredLink[] = []
  const seenLinks = new Set<string>()

  for (const match of markdown.matchAll(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const text = normalizeWhitespace(match[1] ?? '')
    const href = normalizeHref(match[2] ?? '', url)
    if (!text) {
      continue
    }

    const key = `${text} ${href}`
    if (seenLinks.has(key)) {
      continue
    }

    links.push({ text, href })
    seenLinks.add(key)
    if (links.length >= 25) {
      break
    }
  }

  return links
}

const buildStructuredContent = (
  title: string,
  description: string,
  markdown: string,
  url: string,
): StructuredContent => {
  const headings: StructuredHeading[] = []
  const sections: StructuredSection[] = []
  const lines = markdown.split('\n')
  let currentSection: StructuredSection | null = null

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line.trim())
    if (headingMatch) {
      flushCurrentSection(currentSection, sections)
      const text = stripMarkdownInline(headingMatch[2] ?? '')
      const level = (headingMatch[1] ?? '').length

      headings.push({ level, text })
      currentSection = { heading: text, level, content: '' }
      continue
    }

    if (!currentSection) {
      continue
    }

    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    currentSection.content = `${currentSection.content}\n${trimmed}`.trim()
  }

  flushCurrentSection(currentSection, sections)

  if (sections.length === 0 && description) {
    sections.push({
      heading: 'Overview',
      level: 1,
      content: description,
    })
  }

  return {
    title,
    description: description || null,
    headings,
    sections,
    links: collectStructuredLinks(markdown, url),
  }
}

const selectOutputContent = (
  outputMode: OutputMode,
  markdown: string,
  primaryMarkdown: string,
  html: string,
  structuredContent: StructuredContent,
): string => {
  switch (outputMode) {
    case 'primary':
      return primaryMarkdown || markdown
    case 'html':
      return html
    case 'structured':
      return JSON.stringify(structuredContent, null, 2)
    case 'markdown':
    default:
      return markdown
  }
}

const selectWordCountBase = (
  outputMode: OutputMode,
  markdown: string,
  primaryMarkdown: string,
  structuredContent: StructuredContent,
): string => {
  switch (outputMode) {
    case 'primary':
      return primaryMarkdown || markdown
    case 'structured':
      return structuredContent.sections.map((section) => section.content).join(' ')
    case 'html':
    case 'markdown':
    default:
      return markdown
  }
}

export const extractFromHtml = async (
  url: string,
  html: string,
  strategy: FetchStrategy,
  outputMode: OutputMode = 'markdown',
): Promise<FetchResult> => {
  let dom: JSDOM | null = null

  try {
    dom = new JSDOM(html, { url })
    const { document } = dom.window
    const description = getMetaDescription(document)
    const primary = extractPrimaryMarkdown(document, description)
    const cleaned = buildCleanedHtml(url, html)
    let markdown = ''

    try {
      markdown = await convertHtmlToMarkdown(cleaned.html)
    } catch {
      markdown = turndown.turndown(cleaned.html).trim()
    }

    if (!markdown) {
      markdown = primary.markdown || description
    }

    const title = primary.title || cleaned.title
    const structuredContent = buildStructuredContent(title, description, markdown, url)
    const content = selectOutputContent(
      outputMode,
      markdown,
      primary.markdown,
      html,
      structuredContent,
    )
    const wordCountBase = selectWordCountBase(
      outputMode,
      markdown,
      primary.markdown,
      structuredContent,
    )

    return {
      url,
      title,
      author: primary.author,
      content,
      outputMode,
      markdown,
      primaryMarkdown: primary.markdown,
      html,
      structuredContent,
      wordCount: countWords(wordCountBase),
      fetchedAt: new Date(),
      strategy,
      attempts: [],
    }
  } catch {
    const fallbackMarkdown = turndown.turndown(html).trim()
    const fallbackStructuredContent =
      outputMode === 'structured'
        ? buildStructuredContent('', '', fallbackMarkdown, url)
        : null

    return {
      url,
      title: '',
      author: null,
      content:
        outputMode === 'html'
          ? html
          : outputMode === 'structured'
            ? JSON.stringify(fallbackStructuredContent, null, 2)
            : fallbackMarkdown,
      outputMode,
      markdown: fallbackMarkdown,
      primaryMarkdown: fallbackMarkdown,
      html,
      structuredContent: fallbackStructuredContent,
      wordCount: countWords(fallbackMarkdown),
      fetchedAt: new Date(),
      strategy,
      attempts: [],
    }
  } finally {
    dom?.window.close()
  }
}
