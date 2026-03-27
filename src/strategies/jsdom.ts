import { JSDOM, VirtualConsole } from 'jsdom'
import { DEFAULT_TIMEOUT_MS, DEFAULT_USER_AGENT } from '../core/http.js'
import type { FetchEngineContext } from '../core/types.js'

export const runJsdomStrategy = async (
  url: string,
  html: string,
  context: FetchEngineContext
): Promise<string> => {
  const timeoutMs = context.options.jsdomTimeout ?? context.options.timeout ?? DEFAULT_TIMEOUT_MS
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('error', () => undefined)

  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    userAgent: context.options.userAgent || context.headers['User-Agent'] || DEFAULT_USER_AGENT,
    virtualConsole,
  })

  const waitForLoad = () =>
    new Promise<void>((resolve) => {
      if (dom.window.document.readyState === 'complete') {
        resolve()
        return
      }

      const timeout = setTimeout(resolve, timeoutMs)
      dom.window.addEventListener(
        'load',
        () => {
          clearTimeout(timeout)
          resolve()
        },
        { once: true }
      )
    })

  await waitForLoad()
  const renderedHtml = dom.serialize()
  dom.window.close()

  return renderedHtml
}
