import type { FetchResult } from './types'

export const serializeFetchResult = (result: FetchResult) => ({
  ...result,
  fetchedAt: result.fetchedAt.toISOString(),
})
