/**
 * Knowledge-base retrieval contract (interface v0.2) and plugin configuration
 * shared by the mock and HTTP retrievers.
 *
 * @module @deepseek-ai/dsh-pre-retrieval
 */

/** One retrieval hit as returned by the knowledge base. */
export interface KbHit {
  /** Stable identifier of the source document or symbol. */
  readonly doc_id: string
  /** Short human-readable title. */
  readonly title: string
  /** Path or file:line location of the source. */
  readonly path: string
  /** Compact snippet, ≤ 500 chars recommended — it enters the context verbatim. */
  readonly snippet: string
  /** Relevance score in [0, 1]; the plugin drops hits below `minScore`. */
  readonly score: number
  /** Source namespace, e.g. `docs` or `code`. */
  readonly source: string
}

/** One conversation-context entry handed to the knowledge base for understanding. */
export interface KbContextEntry {
  readonly role: 'user' | 'assistant' | 'tool'
  /** Bounded text of the entry (the plugin truncates long tool outputs). */
  readonly text: string
  /** Tool name when `role` is `tool`. */
  readonly name?: string
}

/** Request body for `POST /search` (interface contract v0.2). */
export interface KbSearchRequest {
  /**
   * Optional plugin-side query (rule mode). Omitted when the knowledge base
   * understands the full `context` itself (context mode).
   */
  readonly query?: string
  /** Conversation context handed to the knowledge base for understanding. */
  readonly context?: readonly KbContextEntry[]
  readonly top_k: number
  readonly sources?: readonly string[]
  readonly scope?: Readonly<Record<string, unknown>> | null
}

/** Response body for `POST /search` (interface contract v0.2). */
export interface KbSearchResponse {
  readonly hits: readonly KbHit[]
  /** True when the endpoint dropped hits beyond an internal cap. */
  readonly truncated?: boolean
  /**
   * True when the endpoint already de-duplicated hits against an earlier
   * retrieval in this conversation. The plugin does not depend on this: it
   * de-duplicates by `doc_id` itself.
   */
  readonly incremental?: boolean
}

/** Options for one plugin-side retrieval. */
export interface RetrieveOptions {
  readonly topK: number
  readonly sources?: readonly string[]
  readonly scope?: Readonly<Record<string, unknown>> | null
  /** Conversation context for knowledge-base-side understanding (v0.2). */
  readonly context?: readonly KbContextEntry[]
}

/** Normalized result of one retrieval, with provenance and timing for telemetry. */
export interface RetrieveResult {
  readonly hits: readonly KbHit[]
  /** Retriever identity (`mock` | `http`). */
  readonly source: string
  readonly truncated: boolean
  readonly latencyMs: number
}

/** Deterministic retrieval backend the plugin depends on (mock | http). */
export interface Retriever {
  readonly source: string
  retrieve(query: string, options: RetrieveOptions): Promise<RetrieveResult>
}

/** Raised when the HTTP knowledge base is unreachable, slow, or malformed. */
export class RetrieverError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RetrieverError'
  }
}

/** Configuration for the HTTP knowledge-base backend (interface v0.2). */
export interface HttpRetrieverConfig {
  /** Full `POST` endpoint, e.g. `http://kb.internal/search`. */
  readonly endpoint: string
  /** Per-request timeout in milliseconds. Defaults to 3000. */
  readonly timeoutMs?: number
  /** Extra request headers, e.g. internal auth tokens. */
  readonly headers?: Readonly<Record<string, string>>
}

/**
 * Plugin configuration. Every field is optional; cordis.yml entries and
 * `$DSH_HOME/settings.yaml` overlays can override any of them.
 */
export interface PreRetrievalConfig {
  /** Master switch. Defaults to `true`. */
  readonly enabled?: boolean
  /** Retrieval backend. Defaults to `mock` until the real KB endpoint exists. */
  readonly retriever?: 'mock' | 'http'
  /**
   * How the retrieval query is derived. `rule` slices the first user message
   * (`queryChars`); `context` hands the bounded conversation context to the
   * knowledge base to understand and retrieve (default).
   */
  readonly queryMode?: 'rule' | 'context'
  /**
   * When to inject. `once` injects on the first turn only; `per-turn` also
   * checks later turns and injects only hits whose `doc_id` was not injected
   * before (knowledge needs that arise mid-conversation). Defaults to `once`.
   */
  readonly injectMode?: 'once' | 'per-turn'
  /** Maximum hits injected per turn. Defaults to 3. */
  readonly topK?: number
  /** Hard budget for the injected text in characters. Defaults to 4000. */
  readonly maxChars?: number
  /** Drop hits scoring below this. Defaults to 0.2. */
  readonly minScore?: number
  /** Leading characters of the task text used as the query. Defaults to 800. */
  readonly queryChars?: number
  /** Total text budget of the context handed to the KB in context mode. Defaults to 2000. */
  readonly contextMaxChars?: number
  /** Optional retrieval scope (e.g. repo/team filters) forwarded verbatim. */
  readonly scope?: Readonly<Record<string, unknown>> | null
  /** HTTP backend configuration; required when `retriever: http`. */
  readonly http?: HttpRetrieverConfig
}
