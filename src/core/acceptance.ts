import type { FetchOptions, FetchResult } from './types.js'

const DEFAULT_MIN_HTML_LENGTH = 200
const DEFAULT_MIN_MARKDOWN_LENGTH = 100
const DEFAULT_MIN_WORD_COUNT = 10
const DEFAULT_BLOCKED_WORD_COUNT_THRESHOLD = 200

const DEFAULT_BLOCKED_PATTERNS: RegExp[] = [
  /attention required/i,
  /access denied/i,
  /are you human/i,
  /captcha/i,
  /cloudflare/i,
  /robot check/i,
  /verify you are/i,
]

const PAYWALL_TEXT_SIGNALS: RegExp[] = [
  /subscribe to continue reading/i,
  /this article is for subscribers/i,
  /you['']ve reached your (free )?article limit/i,
  /unlock this story/i,
  /member[- ]only content/i,
  /subscribe for unlimited access/i,
  /create a free account to (read|continue)/i,
  /sign up to read/i,
  /paywall/i,
  /subscriber exclusive/i,
  /already a subscriber\? (log|sign) in/i,
  /get unlimited access/i,
  /read the full (article|story) with a subscription/i,
]

const normalizePatterns = (patterns: Array<string | RegExp> | undefined): RegExp[] => {
  if (patterns === undefined) {
    return DEFAULT_BLOCKED_PATTERNS
  }

  if (patterns.length === 0) {
    return []
  }

  return patterns.map((pattern) =>
    typeof pattern === 'string' ? new RegExp(pattern, 'i') : pattern,
  )
}

const getValidationText = (result: FetchResult): string =>
  result.outputMode === 'primary'
    ? result.primaryMarkdown || result.markdown
    : result.markdown

const buildTextHaystack = (result: FetchResult): string =>
  `${result.title}\n${getValidationText(result)}`

const isLikelyBlocked = (result: FetchResult, options: FetchOptions): boolean => {
  const threshold =
    options.blockedWordCountThreshold ?? DEFAULT_BLOCKED_WORD_COUNT_THRESHOLD
  if (countWords(getValidationText(result)) >= threshold) {
    return false
  }

  const patterns = normalizePatterns(options.blockedTextPatterns)
  const haystack = buildTextHaystack(result)

  return patterns.some((pattern) => pattern.test(haystack))
}

const countWords = (value: string): number => value.split(/\s+/).filter(Boolean).length

const isLikelyPaywalled = (result: FetchResult): boolean => {
  const haystack = buildTextHaystack(result)
  return PAYWALL_TEXT_SIGNALS.some((pattern) => pattern.test(haystack))
}

export const validateResult = (
  result: FetchResult,
  options: FetchOptions,
): { acceptable: boolean; reason?: string } => {
  const minHtmlLength = options.minHtmlLength ?? DEFAULT_MIN_HTML_LENGTH
  const minMarkdownLength = options.minMarkdownLength ?? DEFAULT_MIN_MARKDOWN_LENGTH
  const minWordCount = options.minWordCount ?? DEFAULT_MIN_WORD_COUNT
  const validationText = getValidationText(result)
  const validationWordCount = countWords(validationText)

  if (result.html.trim().length < minHtmlLength) {
    return {
      acceptable: false,
      reason: `html length ${result.html.trim().length} below minimum ${minHtmlLength}`,
    }
  }

  if (validationText.trim().length < minMarkdownLength) {
    return {
      acceptable: false,
      reason: `markdown length ${validationText.trim().length} below minimum ${minMarkdownLength}`,
    }
  }

  if (validationWordCount < minWordCount) {
    return {
      acceptable: false,
      reason: `word count ${validationWordCount} below minimum ${minWordCount}`,
    }
  }

  if (isLikelyBlocked(result, options)) {
    return {
      acceptable: false,
      reason: 'content appears blocked by anti-bot checks',
    }
  }

  if (isLikelyPaywalled(result)) {
    return {
      acceptable: false,
      reason: 'content appears paywalled',
    }
  }

  return { acceptable: true }
}
