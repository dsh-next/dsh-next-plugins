/**
 * jsdom render test for the markdown preview renderer: block constructs,
 * inline styles, and the security properties (no raw HTML injection, unsafe
 * link protocols stripped).
 */
import { describe, expect, it } from 'vitest'
import * as React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderMarkdown } from '../src/client/markdown.tsx'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement | null = null
let root: Root | null = null

async function renderToHtml(source: string): Promise<string> {
  if (container === null) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  await import('react').then((React) => React.act(async () => {
    root!.render(React.createElement('div', null, renderMarkdown(source)))
  }))
  return container.innerHTML
}

describe('renderMarkdown blocks', () => {
  it('renders ATX headings at their level', async () => {
    const html = await renderToHtml('# Title\n## Sub\n### Deep')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<h2>Sub</h2>')
    expect(html).toContain('<h3>Deep</h3>')
  })

  it('renders fenced code blocks as pre>code without inline parsing', async () => {
    const html = await renderToHtml('```bash\nnpm install --save **not-bold**\n```')
    expect(html).toContain('<pre')
    expect(html).toContain('<code')
    expect(html).toContain('npm install --save **not-bold**')
    expect(html).not.toContain('<strong>')
  })

  it('renders unordered and ordered lists', async () => {
    const ul = await renderToHtml('- one\n- two')
    expect(ul).toContain('<ul>')
    expect(ul).toContain('<li>one</li>')
    const ol = await renderToHtml('1. first\n2. second')
    expect(ol).toContain('<ol>')
    expect(ol).toContain('<li>first</li>')
  })

  it('renders pipe tables with header and body rows', async () => {
    const html = await renderToHtml('| a | b |\n| --- | --- |\n| 1 | 2 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>a</th>')
    expect(html).toContain('<td>1</td>')
  })

  it('renders blockquotes and horizontal rules', async () => {
    const html = await renderToHtml('> quoted text\n\n---')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('quoted text')
    expect(html).toContain('<hr')
  })

  it('joins consecutive plain lines into one paragraph', async () => {
    const html = await renderToHtml('first line\nsecond line')
    expect((html.match(/<p>/g) ?? []).length).toBe(1)
    expect(html).toContain('first line second line')
  })
})

describe('renderMarkdown inline', () => {
  it('renders bold, italic, strikethrough, and inline code', async () => {
    const html = await renderToHtml('**bold** and *italic* and ~~gone~~ and `code`')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<del>gone</del>')
    expect(html).toContain('<code>code</code>')
  })

  it('renders http(s) and mailto links with rel protection', async () => {
    const html = await renderToHtml('[site](https://example.com) [mail](mailto:a@b.c)')
    expect(html).toContain('<a href="https://example.com"')
    expect(html).toContain('rel="noreferrer noopener"')
    expect(html).toContain('<a href="mailto:a@b.c"')
  })
})

describe('renderMarkdown security', () => {
  it('renders raw HTML as escaped text, never as markup', async () => {
    const html = await renderToHtml('hello <script>alert(1)</script> <img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;script&gt;')
  })

  it('strips javascript: and data: link targets', async () => {
    const html = await renderToHtml('[click](javascript:alert(1)) [drop](data:text/html,evil)')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('href="data:')
    expect(html).toContain('click')
  })
})
