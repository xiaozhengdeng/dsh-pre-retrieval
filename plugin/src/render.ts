/**
 * Compact, attributable rendering of retrieved hits with a hard character
 * budget. Everything rendered here enters the model context verbatim and is
 * re-billed every round, so brevity is the point.
 *
 * @module @deepseek-ai/dsh-pre-retrieval
 */

import type { KbHit } from './types.ts'

/** Provenance rendered into the header line for attribution and debugging. */
export interface InjectionMeta {
  /** Retriever identity (`mock` | `http`). */
  readonly source: string
  /** Optional extra label, e.g. a knowledge-base version tag. */
  readonly label?: string
}

/** Result of one injection render. */
export interface RenderResult {
  /** The final injected text, within the budget. */
  readonly text: string
  /** True when the full text was cut to fit `maxChars`. */
  readonly truncated: boolean
  /** Length of the returned text in characters. */
  readonly chars: number
}

const HEADER_PREFIX = '【预检索资料'
const HEADER_SUFFIX = '】'
const ELLIPSIS = '…'

/** Render hits as a short attributed block, truncated to `maxChars`. */
export function renderInjection(meta: InjectionMeta, hits: readonly KbHit[], maxChars: number): RenderResult {
  const counts = new Map<string, number>()
  for (const hit of hits) {
    counts.set(hit.source, (counts.get(hit.source) ?? 0) + 1)
  }
  const breakdown = [...counts.entries()]
    .map(([source, count]) => `${source}:${String(count)}`)
    .join(' ')
  const label = meta.label === undefined || meta.label.length === 0 ? '' : ` ${meta.label}`
  const lines: string[] = [`${HEADER_PREFIX} · ${breakdown} · 来源 ${meta.source}${label}${HEADER_SUFFIX}`]
  hits.forEach((hit, index) => {
    lines.push(`${hit.source}[${String(index + 1)}] 《${hit.title}》 ${hit.path}`)
    lines.push(`  ${hit.snippet}`)
  })
  const full = lines.join('\n')
  if (full.length <= maxChars) {
    return { text: full, truncated: false, chars: full.length }
  }
  const text = `${full.slice(0, maxChars - 1)}${ELLIPSIS}`
  return { text, truncated: true, chars: text.length }
}
