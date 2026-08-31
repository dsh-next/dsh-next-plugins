/**
 * Minimal, dependency-free markdown renderer for skill previews. Produces
 * React elements directly — no HTML string is ever built or injected, so
 * remote skill content cannot smuggle markup through (`<script>` in a body
 * renders as escaped text). Links are restricted to http(s)/mailto; anything
 * else renders as plain text.
 *
 * Supported block constructs: fenced code fences, ATX headings, blockquotes,
 * unordered/ordered lists (one nesting level), pipe tables, horizontal rules,
 * and paragraphs. Inline: code spans, bold, italic, strikethrough, links.
 * Unknown constructs degrade to plain text rather than erroring.
 */
import * as React from 'react'

/** Whether a link href is safe to render as an anchor. */
function safeHref(href: string): string | undefined {
  try {
    const url = new URL(href, 'https://placeholder.invalid')
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
      return href.startsWith('/') || href.startsWith('#') ? undefined : href
    }
    return undefined
  } catch {
    return undefined
  }
}

interface InlineToken {
  text?: string
  code?: string
  bold?: string
  italic?: string
  strike?: string
  href?: string
  linkText?: string
}

/** One pass of inline tokenization: code, links, bold, italic, strikethrough. */
function tokenizeInline(text: string): InlineToken[] {
  const pattern = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)|(~~[^~]+~~)/g
  const tokens: InlineToken[] = []
  let last = 0
  for (let match = pattern.exec(text); match !== null; match = pattern.exec(text)) {
    if (match.index > last) tokens.push({ text: text.slice(last, match.index) })
    const [raw, code, link, bold, boldAlt, italic, italicAlt, strike] = match
    if (code !== undefined) tokens.push({ code: code.slice(1, -1) })
    else if (link !== undefined) {
      const close = link.indexOf('](')
      tokens.push({ linkText: link.slice(1, close), href: link.slice(close + 2, -1) })
    } else if (bold !== undefined) tokens.push({ bold: bold.slice(2, -2) })
    else if (boldAlt !== undefined) tokens.push({ bold: boldAlt.slice(2, -2) })
    else if (italic !== undefined) tokens.push({ italic: italic.slice(1, -1) })
    else if (italicAlt !== undefined) tokens.push({ italic: italicAlt.slice(1, -1) })
    else if (strike !== undefined) tokens.push({ strike: strike.slice(2, -2) })
    else tokens.push({ text: raw })
    last = match.index + raw.length
  }
  if (last < text.length) tokens.push({ text: text.slice(last) })
  return tokens
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  return tokenizeInline(text).map((token, i) => {
    const key = `${keyPrefix}-${i}`
    if (token.code !== undefined) return React.createElement('code', { key }, token.code)
    if (token.bold !== undefined) return React.createElement('strong', { key }, token.bold)
    if (token.italic !== undefined) return React.createElement('em', { key }, token.italic)
    if (token.strike !== undefined) return React.createElement('del', { key }, token.strike)
    if (token.href !== undefined) {
      const href = safeHref(token.href)
      if (href === undefined) return React.createElement('span', { key }, token.linkText)
      return React.createElement('a', { key, href, target: '_blank', rel: 'noreferrer noopener' }, token.linkText)
    }
    return React.createElement(React.Fragment, { key }, token.text)
  })
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.includes('|', 1)
}

function isTableSeparator(line: string): boolean {
  return /^\|(\s*:?-+:?\s*\|)+$/.test(line.trim())
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

/** Render one markdown source string into a React element tree. */
export function renderMarkdown(source: string): React.ReactElement {
  const lines = source.split('\n')
  const blocks: React.ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block.
    if (line.trimStart().startsWith('```')) {
      const lang = line.trim().slice(3).trim()
      const body: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        body.push(lines[i])
        i += 1
      }
      i += 1 // closing fence (or end of input)
      const code = React.createElement('code', { key: `code-${key}` }, body.join('\n'))
      blocks.push(React.createElement('pre', { key: `fence-${key++}`, className: lang !== '' ? `lang-${lang}` : undefined }, code))
      continue
    }

    // Horizontal rule.
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      blocks.push(React.createElement('hr', { key: `hr-${key++}` }))
      i += 1
      continue
    }

    // ATX heading.
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      const level = heading[1].length
      blocks.push(React.createElement(`h${level}`, { key: `h-${key++}` }, renderInline(heading[2], `h${key}`)))
      i += 1
      continue
    }

    // Blockquote (consecutive > lines form one block).
    if (line.trimStart().startsWith('>')) {
      const quoted: string[] = []
      while (i < lines.length && lines[i].trimStart().startsWith('>')) {
        quoted.push(lines[i].trimStart().replace(/^>\s?/, ''))
        i += 1
      }
      blocks.push(React.createElement('blockquote', { key: `q-${key++}` }, renderInline(quoted.join(' '), `q${key}`)))
      continue
    }

    // Pipe table: header row, separator row, then body rows.
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitTableRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitTableRow(lines[i]))
        i += 1
      }
      const cells = (row: string[], tag: string, keyPrefix: string) =>
        row.map((cell, c) => React.createElement(tag, { key: `${keyPrefix}-${c}` }, renderInline(cell, `${keyPrefix}-${c}`)))
      blocks.push(React.createElement('table', { key: `table-${key++}` },
        React.createElement('thead', { key: 'thead' },
          React.createElement('tr', { key: 'head-row' }, cells(header, 'th', 'th'))),
        React.createElement('tbody', { key: 'tbody' },
          rows.map((row, r) => React.createElement('tr', { key: `row-${r}` }, cells(row, 'td', `td-${r}`))))))
      continue
    }

    // Unordered list (single nesting level by indentation).
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: React.ReactNode[] = []
      let item = 0
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const indent = lines[i].length - lines[i].trimStart().length
        const text = lines[i].trimStart().replace(/^[-*+]\s+/, '')
        if (indent >= 2 && items.length > 0) {
          // Nested item: append to the previous item's content.
          const previous = items[items.length - 1]
          items[items.length - 1] = React.createElement(React.Fragment, { key: `li-${item - 1}` },
            previous, React.createElement('div', { key: `sub-${key}`, className: 'md-subitem' }, renderInline(text, `sub-${key}`)))
          key += 1
        } else {
          items.push(React.createElement('li', { key: `li-${item}` }, renderInline(text, `li-${item}`)))
        }
        item += 1
        i += 1
      }
      blocks.push(React.createElement('ul', { key: `ul-${key++}` }, items))
      continue
    }

    // Ordered list.
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: React.ReactNode[] = []
      let item = 0
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(React.createElement('li', { key: `oli-${item}` }, renderInline(lines[i].trimStart().replace(/^\d+[.)]\s+/, ''), `oli-${item}`)))
        item += 1
        i += 1
      }
      blocks.push(React.createElement('ol', { key: `ol-${key++}` }, items))
      continue
    }

    // Blank line: skip.
    if (line.trim() === '') {
      i += 1
      continue
    }

    // Paragraph: consecutive non-empty, non-structural lines.
    const paragraph: string[] = []
    while (
      i < lines.length && lines[i].trim() !== ''
      && !lines[i].trimStart().startsWith('```')
      && !/^(#{1,6})\s+/.test(lines[i])
      && !lines[i].trimStart().startsWith('>')
      && !/^\s*[-*+]\s+/.test(lines[i])
      && !/^\s*\d+[.)]\s+/.test(lines[i])
      && !isTableRow(lines[i])
      && !/^\s*([-*_])\s*(\1\s*){2,}$/.test(lines[i])
    ) {
      paragraph.push(lines[i])
      i += 1
    }
    if (paragraph.length > 0) {
      blocks.push(React.createElement('p', { key: `p-${key++}` }, renderInline(paragraph.join(' '), `p${key}`)))
    }
  }

  return React.createElement('div', { className: 'md-root' }, blocks)
}
