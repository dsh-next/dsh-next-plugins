/**
 * The native Models page addresses every declared provider row as
 * `providers.<nativeId>` (`llm.registerConfigurableProviders` in
 * src/index.ts) and resolves that path against the serialized entry schema
 * (`SettingsSchemaService.nodeAtPath` in `@deepseek-ai/dsh-client-ui-settings`).
 * A row whose path does not resolve renders
 * `"<provider>: unresolvable settings path"` INSTEAD of an editor card, so the
 * card loses its Cancel and Apply with it.
 *
 * The traversal below is the platform rule verbatim: an object node descends
 * through `dict`, a dict or array node descends through `inner`, and any other
 * node type (a union, for example) ends the walk.
 */
import Schema from '@deepseek-ai/schemastery'
import { describe, expect, it } from 'vitest'
import { FAMILIES } from '../src/core/catalog.ts'
import { pluginConfigSchema } from '../src/core/schema.ts'
import { normalizeConfig } from '../src/core/settings.ts'

interface SchemaNode {
  type: string
  dict?: Record<string, SchemaNode>
  inner?: SchemaNode
}

function nodeAtPath(root: SchemaNode | undefined, path: readonly string[]): SchemaNode | undefined {
  let node: SchemaNode | undefined = root
  for (const key of path) {
    if (node === undefined) return undefined
    if (node.type === 'object') node = node.dict?.[key]
    else if (node.type === 'dict' || node.type === 'array') node = node.inner
    else return undefined
  }
  return node
}

/** The schema as the settings service hands it to the page. */
function serializedRoot(): SchemaNode {
  return new Schema(JSON.parse(JSON.stringify(pluginConfigSchema.toJSON()))) as unknown as SchemaNode
}

describe('native Models page settings path', () => {
  it('resolves providers.<nativeId> for every configured family', () => {
    for (const family of FAMILIES) {
      expect(nodeAtPath(serializedRoot(), ['providers', family.nativeId]), family.nativeId).toBeDefined()
    }
  })

  it('accepts the profile dict the plugin stores', () => {
    const stored = { providers: { 'openai-codex': { displayName: 'ChatGPT' } } }
    expect(() => Schema(pluginConfigSchema)(stored)).not.toThrow()
    expect(normalizeConfig(stored).providers['openai-codex']).toEqual({ displayName: 'ChatGPT' })
  })

  it('loads a pre-0.1.7 row array instead of failing the entry', () => {
    const legacy = { providers: [{ id: 'openai-codex', displayName: 'ChatGPT' }] }
    expect(() => Schema(pluginConfigSchema)(legacy)).not.toThrow()
    expect(normalizeConfig(legacy).providers['openai-codex']).toEqual({ displayName: 'ChatGPT' })
  })
})
