import { describe, expect, it } from 'bun:test'
import { extractFromHtml } from './extract.js'

const ARTICLE_HTML = `<!DOCTYPE html>
<html>
  <head>
    <title>Example Domain</title>
    <meta
      name="description"
      content="Example metadata that should not replace real article content."
    />
  </head>
  <body>
    <header>
      <nav><a href="/docs">Docs</a></nav>
    </header>
    <article>
      <h1>Example Domain</h1>
      <p>This domain is for use in illustrative examples in documents.</p>
    </article>
    <footer>Footer links</footer>
  </body>
</html>`

const PORTAL_HTML = `<!DOCTYPE html>
<html>
  <head>
    <title>Investing.com - Stock Market Quotes &amp; Financial News</title>
    <meta
      name="description"
      content="Real-time quotes, charts, news &amp; tools from Investing.com. Get AI analysis &amp; premium data with InvestingPro to uncover strategic market opportunities."
    />
  </head>
  <body>
    <header>
      <nav>
        <a href="/markets">Markets</a>
        <a href="/news">News</a>
      </nav>
    </header>
    <main>
      <section>
        <h2><a href="/news">News</a></h2>
        <article>
          <a href="/news/hero">Hero image</a>
          <h3>
            <a href="/news/hero">Asia stocks fall as Iran uncertainty persists</a>
          </h3>
          <p>Asian stocks moved in a flat-to-low range on Friday.</p>
        </article>
      </section>
      <section>
        <h2><a href="/markets">Markets</a></h2>
        <table>
          <thead>
            <tr><th>Name</th><th>Last</th></tr>
          </thead>
          <tbody>
            <tr><td>Dow Jones</td><td>45,960.11</td></tr>
            <tr><td>S&amp;P 500</td><td>6,477.16</td></tr>
          </tbody>
        </table>
      </section>
    </main>
    <footer>
      <p>Risk Disclosure: Trading in financial instruments involves high risks.</p>
      <p>Fusion Media Limited. All Rights Reserved.</p>
    </footer>
  </body>
</html>`

describe('extractFromHtml', () => {
  it('returns cleaned full-page markdown by default', async () => {
    const result = await extractFromHtml('https://example.com', ARTICLE_HTML, 'fetch')

    expect(result.outputMode).toBe('markdown')
    expect(result.title).toBe('Example Domain')
    expect(result.content).toContain('# Example Domain')
    expect(result.markdown).toContain('This domain is for use in illustrative examples')
    expect(result.markdown).not.toContain('Footer links')
  })

  it('returns primary readability content when requested', async () => {
    const result = await extractFromHtml(
      'https://example.com',
      ARTICLE_HTML,
      'fetch',
      'primary',
    )

    expect(result.outputMode).toBe('primary')
    expect(result.content).toContain('This domain is for use in illustrative examples')
    expect(result.primaryMarkdown).toContain(
      'This domain is for use in illustrative examples',
    )
  })

  it('returns structured sections for portal pages', async () => {
    const result = await extractFromHtml(
      'https://www.investing.com',
      PORTAL_HTML,
      'fetch',
      'structured',
    )

    expect(result.markdown).toContain('## [News]')
    expect(result.markdown).toContain('## [Markets]')
    expect(result.markdown).not.toContain('Risk Disclosure')
    expect(
      result.structuredContent?.sections.some((section) => section.heading === 'News'),
    ).toBe(true)
    expect(
      result.structuredContent?.links.some((link) => link.href.endsWith('/news/hero')),
    ).toBe(true)

    const structured = JSON.parse(result.content) as { title: string }
    expect(structured.title).toContain('Stock Market Quotes & Financial News')
  })

  it('keeps structured mode JSON-shaped when extraction falls back', async () => {
    const result = await extractFromHtml(
      'not-a-valid-url',
      ARTICLE_HTML,
      'fetch',
      'structured',
    )

    expect(result.outputMode).toBe('structured')
    expect(result.structuredContent).not.toBeNull()
    expect(() => JSON.parse(result.content)).not.toThrow()

    const structured = JSON.parse(result.content) as {
      sections: Array<{ heading: string; content: string }>
    }
    expect(structured.sections.length).toBeGreaterThan(0)
    expect(structured.sections[0]?.content).toContain(
      'This domain is for use in illustrative examples',
    )
  })
})
