/**
 * highlight.js core plus the languages we map from file extensions.
 * Unknown languages stay plain text.
 */
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import graphql from 'highlight.js/lib/languages/graphql'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import less from 'highlight.js/lib/languages/less'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

let registered = false

function ensureLanguages(): void {
  if (registered) return
  hljs.registerLanguage('bash', bash)
  hljs.registerLanguage('c', c)
  hljs.registerLanguage('cpp', cpp)
  hljs.registerLanguage('csharp', csharp)
  hljs.registerLanguage('css', css)
  hljs.registerLanguage('dockerfile', dockerfile)
  hljs.registerLanguage('go', go)
  hljs.registerLanguage('graphql', graphql)
  hljs.registerLanguage('ini', ini)
  hljs.registerLanguage('java', java)
  hljs.registerLanguage('javascript', javascript)
  hljs.registerLanguage('json', json)
  hljs.registerLanguage('kotlin', kotlin)
  hljs.registerLanguage('less', less)
  hljs.registerLanguage('markdown', markdown)
  hljs.registerLanguage('php', php)
  hljs.registerLanguage('python', python)
  hljs.registerLanguage('ruby', ruby)
  hljs.registerLanguage('rust', rust)
  hljs.registerLanguage('scss', scss)
  hljs.registerLanguage('sql', sql)
  hljs.registerLanguage('swift', swift)
  hljs.registerLanguage('typescript', typescript)
  hljs.registerLanguage('xml', xml)
  hljs.registerLanguage('yaml', yaml)
  registered = true
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Highlight one source line. Falls back to escaped plain text. */
export function highlightLine(text: string, language: string | null): string {
  if (language === null) return escapeHtml(text)
  ensureLanguages()
  if (hljs.getLanguage(language) === undefined) return escapeHtml(text)
  try {
    return hljs.highlight(text, { language, ignoreIllegals: true }).value
  } catch {
    return escapeHtml(text)
  }
}
