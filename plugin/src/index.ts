/**
 * Pre-retrieval context injection.
 *
 * On a step-1 request the plugin derives a query or bounded conversation
 * context (no LLM involved), retrieves knowledge-base hits through the
 * configured {@link Retriever}, and injects the top hits as a plugin-sourced
 * user message. `once` mode injects on the first turn only; `per-turn` mode
 * also covers later turns, injecting only hits whose `doc_id` was not injected
 * before, so knowledge needs that arise mid-conversation are served. Retrieval
 * itself costs 0 tokens; the injected text is billed from the moment it enters
 * the context, so budgets (`topK`, `maxChars`, `minScore`) default to small
 * values and failures degrade silently to no injection.
 *
 * Session state (what was injected, which doc_ids) is reconstructed from the
 * session log, so resumes and compactions that shadow earlier injections stay
 * consistent: once-mode never re-injects, per-turn mode never repeats a doc_id.
 *
 * @module @deepseek-ai/dsh-pre-retrieval
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import { renderInjection } from './render.ts'
import { HttpRetriever, MockRetriever } from './retriever.ts'
import type {
  KbContextEntry,
  PreRetrievalConfig,
  RetrieveResult,
  Retriever,
} from './types.ts'

export { HttpRetriever, MockRetriever } from './retriever.ts'
export { renderInjection } from './render.ts'
export type {
  HttpRetrieverConfig,
  KbContextEntry,
  KbHit,
  KbSearchRequest,
  KbSearchResponse,
  PreRetrievalConfig,
  RetrieveOptions,
  RetrieveResult,
  Retriever,
} from './types.ts'
export { RetrieverError } from './types.ts'

/** Cordis plugin name used by loader diagnostics and session attribution. */
export const name = 'pre-retrieval'

/** Declared service dependencies: the agent registry provides pre-step events. */
export const inject = ['agents']

/** Plugin configuration; every field is optional (see {@link PreRetrievalConfig}). */
export type Config = PreRetrievalConfig

/** Name of the meta section carrying injected doc_ids for resume-safe de-duplication. */
export const IDS_SECTION = 'pre-retrieval-ids'

/** Per-entry text budget when folding conversation context for the KB. */
const PER_ENTRY_CHARS = 800
/** Tool-result entries are summarized harder. */
const PER_TOOL_CHARS = 200

/** Resolved configuration with defaults applied. */
interface ResolvedConfig {
  readonly enabled: boolean
  readonly retriever: 'mock' | 'http'
  readonly queryMode: 'rule' | 'context'
  readonly injectMode: 'once' | 'per-turn'
  readonly topK: number
  readonly maxChars: number
  readonly minScore: number
  readonly queryChars: number
  readonly contextMaxChars: number
  readonly scope: Readonly<Record<string, unknown>> | null
  readonly http: {
    readonly endpoint: string
    readonly timeoutMs: number
    readonly headers: Readonly<Record<string, string>>
  }
}

function resolveConfig(config: PreRetrievalConfig): ResolvedConfig {
  return {
    enabled: config.enabled ?? true,
    retriever: config.retriever ?? 'mock',
    queryMode: config.queryMode ?? 'context',
    injectMode: config.injectMode ?? 'once',
    topK: config.topK ?? 3,
    maxChars: config.maxChars ?? 4000,
    minScore: config.minScore ?? 0.2,
    queryChars: config.queryChars ?? 800,
    contextMaxChars: config.contextMaxChars ?? 2000,
    scope: config.scope ?? null,
    http: {
      endpoint: config.http?.endpoint ?? '',
      timeoutMs: config.http?.timeoutMs ?? 3000,
      headers: config.http?.headers ?? {},
    },
  }
}

/** Text of a message's text blocks, joined. */
function messageText(message: { content: readonly ContentBlock[] }): string {
  return message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

/** Extract the rule-mode query from pending user messages, bounded. */
function extractQuery(messages: readonly UserMessage[], maxChars: number): string {
  return messages.map(messageText).join('\n').trim().slice(0, maxChars)
}

/**
 * Fold the pending messages plus recent session history into bounded
 * context entries (time order: history first, pending last) for the
 * knowledge base to understand. The plugin's own injections and tool
 * payloads are skipped or aggressively summarized.
 */
function extractContext(
  messages: readonly UserMessage[],
  session: Session,
  maxChars: number,
): KbContextEntry[] {
  const history: KbContextEntry[] = []
  let budget = maxChars
  for (const event of [...session.events].reverse()) {
    if (budget <= 0) break
    let entry: KbContextEntry | undefined
    if (event.type === 'user/message') {
      if (event.data.source.kind === 'plugin') continue
      const text = messageText(event.data).trim()
      if (text.length === 0) continue
      entry = { role: 'user', text: text.slice(0, PER_ENTRY_CHARS) }
    } else if (event.type === 'assistant/message') {
      const text = messageText(event.data.message).trim()
      if (text.length === 0) continue
      entry = { role: 'assistant', text: text.slice(0, PER_ENTRY_CHARS) }
    } else if (event.type === 'tool/result') {
      const text = messageText(event.data.message).trim()
      if (text.length === 0) continue
      entry = { role: 'tool', text: text.slice(0, PER_TOOL_CHARS) }
    }
    if (entry === undefined) continue
    history.unshift(entry)
    budget -= entry.text.length
  }
  const pending = messages.map((message) => {
    const text = messageText(message).trim()
    return { role: 'user' as const, text: text.slice(0, PER_ENTRY_CHARS) }
  }).filter(entry => entry.text.length > 0)
  return [...history, ...pending]
}

/** Whether the session log already carries one of this plugin's injections. */
function hasInjection(session: Session): boolean {
  return session.events.some(event =>
    event.type === 'user/message'
    && event.data.source.kind === 'plugin'
    && event.data.source.plugin === name)
}

/** Rebuild the set of doc_ids already injected, from the session log. */
function collectInjectedIds(session: Session): Set<string> {
  const ids = new Set<string>()
  for (const event of session.events) {
    if (event.type !== 'user/message') continue
    const source = event.data.source
    if (source.kind !== 'plugin' || source.plugin !== name) continue
    const sections = 'sections' in source ? source.sections : undefined
    if (sections === undefined) continue
    for (const section of sections) {
      if (section.name === IDS_SECTION) {
        for (const id of section.text.split(',')) {
          if (id.length > 0) ids.add(id)
        }
      }
    }
  }
  return ids
}

/**
 * Register the pre-retrieval listener for the lifetime of `ctx`.
 * @param ctx - plugin context; the listener is disposed with it.
 * @param rawConfig - optional plugin configuration (defaults apply).
 */
export function apply(ctx: Context, rawConfig: PreRetrievalConfig = {}): void {
  const config = resolveConfig(rawConfig)
  const retriever: Retriever = config.retriever === 'http'
    ? new HttpRetriever(config.http)
    : new MockRetriever()

  // Failures mark their scope so a broken KB never turns into a retry loop:
  // once-mode failures mark the whole session; per-turn failures mark the turn
  // (the next turn may retry). Injected doc_ids are always rebuilt from the
  // session log, so resumes stay consistent without in-memory state.
  const failedSessions = new Set<string>()
  const failedTurns = new Map<string, number>()

  ctx.on('agent/pre-step', async (
    { agent, messages, turn, step, signal },
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    if (!config.enabled) return decision
    if (step !== 1) return decision

    // Once mode: a session with any prior injection (or prior failure) is done.
    if (config.injectMode === 'once') {
      if (hasInjection(agent.session) || failedSessions.has(agent.id)) return decision
    } else {
      if (failedTurns.get(agent.id) === turn || hasInjectionForTurn(agent.session, turn)) {
        return decision
      }
    }

    const injectedIds = collectInjectedIds(agent.session)
    const context = config.queryMode === 'context'
      ? extractContext(messages, agent.session, config.contextMaxChars)
      : undefined
    const query = config.queryMode === 'rule'
      ? extractQuery(messages, config.queryChars)
      : ''

    if (context !== undefined && context.length === 0) return decision
    if (query.length === 0 && context === undefined) return decision

    let result: RetrieveResult
    try {
      result = await retriever.retrieve(query, {
        topK: config.topK,
        scope: config.scope,
        ...(context !== undefined ? { context } : {}),
      })
    } catch (error) {
      console.info(
        `[pre-retrieval] retrieve failed (${retriever.source}): ${error instanceof Error ? error.message : String(error)}`,
      )
      if (config.injectMode === 'once') failedSessions.add(agent.id)
      else failedTurns.set(agent.id, turn)
      return decision
    }

    const fresh = result.hits
      .filter(hit => hit.score >= config.minScore)
      .filter(hit => !injectedIds.has(hit.doc_id))
      .slice(0, config.topK)
    if (fresh.length === 0) {
      console.info(
        `[pre-retrieval] no fresh hits (${retriever.source}, mode=${config.queryMode})`,
      )
      return decision
    }

    const rendered = renderInjection({ source: result.source }, fresh, config.maxChars)
    const ids = fresh.map(hit => hit.doc_id).join(',')
    console.info(
      `[pre-retrieval] injected ${String(rendered.chars)} chars, ${String(fresh.length)} hits, `
      + `${String(result.latencyMs)}ms, truncated=${String(rendered.truncated)}, `
      + `mode=${config.queryMode}/${config.injectMode}`,
    )
    return {
      kind: 'enter',
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text: rendered.text }],
          source: {
            kind: 'plugin',
            plugin: name,
            form: 'snapshot',
            sections: [
              { name, text: rendered.text },
              { name: IDS_SECTION, text: ids },
            ],
          },
        }),
      ],
    }
  }, { prepend: true })
}

/** Whether the current turn already received an injection this plugin. */
function hasInjectionForTurn(session: Session, turn: number): boolean {
  const start = session.events.findLastIndex(
    event => event.type === 'turn/start' && event.data.turn === turn,
  )
  if (start < 0) return false
  return session.events.slice(start + 1).some(event =>
    event.type === 'user/message'
    && event.data.source.kind === 'plugin'
    && event.data.source.plugin === name)
}
