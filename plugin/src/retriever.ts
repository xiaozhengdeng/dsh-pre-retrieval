/**
 * Retrieval backends: a keyword-scoring mock (development/verification) and an
 * HTTP client that speaks the interface contract v0.1 against the internal
 * knowledge base.
 *
 * @module @deepseek-ai/dsh-pre-retrieval
 */

import type {
  HttpRetrieverConfig,
  KbContextEntry,
  KbHit,
  KbSearchRequest,
  Retriever,
  RetrieveOptions,
  RetrieveResult,
} from './types.ts'
import { RetrieverError } from './types.ts'

/** Built-in sample hits used by the mock backend for end-to-end verification. */
const MOCK_HITS: readonly KbHit[] = [
  {
    doc_id: 'mock-deploy-001',
    title: '内网模型服务部署规范',
    path: 'ops/deploy.md',
    snippet: '模型服务统一走 vLLM，必须开启 prefix caching 以复用相同前缀的 KV cache，显著降低重复输入的 prefill 开销。',
    score: 0.9,
    source: 'docs',
  },
  {
    doc_id: 'mock-billing-001',
    title: '计费系统架构',
    path: 'src/architecture/billing.md',
    snippet: '月度计费入口 BillingService：订单结算 → 账单生成 → 对账，超时重试 3 次。',
    score: 0.85,
    source: 'docs',
  },
  {
    doc_id: 'mock-billing-sym',
    title: 'BillingService',
    path: 'src/billing/service.ts:42',
    snippet: 'class BillingService(apiKey) — 月度计费入口，负责订单结算与账单生成。refs: 17',
    score: 0.8,
    source: 'code',
  },
  {
    doc_id: 'mock-token-001',
    title: 'token 节省最佳实践',
    path: 'ops/token.md',
    snippet: '检索结果一进上下文即按每轮重复计费；工具输出尽量短，先取索引再精取片段。',
    score: 0.75,
    source: 'docs',
  },
  {
    doc_id: 'mock-deploy-002',
    title: '内网模型网关接入',
    path: 'ops/gateway.md',
    snippet: '网关层开启 context caching on disk，缓存命中时重复输入的成本大幅下降。',
    score: 0.7,
    source: 'docs',
  },
]

/** Split text into lower-cased alphanumeric terms (Unicode-aware). */
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(term => term.length > 0)
}

/** All character bigrams of a text, used for CJK overlap scoring. */
function bigrams(text: string): Set<string> {
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}]+/u, '')
  const result = new Set<string>()
  for (let index = 0; index < normalized.length - 1; index += 1) {
    result.add(normalized.slice(index, index + 2))
  }
  return result
}

/**
 * Keyword scoring: query terms weighted by title > path > snippet matches,
 * plus character-bigram overlap so CJK queries without spaces still hit.
 */
function scoreHit(hit: KbHit, query: string, terms: readonly string[]): number {
  let score = 0
  for (const term of terms) {
    if (hit.title.toLowerCase().includes(term)) score += 3
    if (hit.path.toLowerCase().includes(term)) score += 2
    if (hit.snippet.toLowerCase().includes(term)) score += 1
  }
  const queryGrams = bigrams(query)
  const hitGrams = bigrams(`${hit.title} ${hit.path} ${hit.snippet}`)
  for (const gram of queryGrams) {
    if (hitGrams.has(gram)) score += 1
  }
  return score
}

/**
 * Keyword-scoring mock knowledge base. No network, no external state; exists
 * so the full injection pipeline can be developed and verified before the real
 * KB endpoint is available.
 */
export class MockRetriever implements Retriever {
  readonly source = 'mock'

  retrieve(query: string, options: RetrieveOptions): Promise<RetrieveResult> {
    const started = Date.now()
    // Context mode: fold the conversation context into the scoring text,
    // preferring the latest user utterance.
    const effectiveQuery = options.context === undefined
      ? query
      : contextQuery(options.context)
    const terms = tokenize(effectiveQuery)
    const hits = MOCK_HITS
      .map(hit => ({
        hit,
        score: terms.length === 0 ? hit.score : Math.min(1, scoreHit(hit, effectiveQuery, terms) / 5),
      }))
      .filter(entry => terms.length === 0 || entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, options.topK)
      .map(entry => ({ ...entry.hit, score: entry.score }))
    return Promise.resolve({
      hits,
      source: this.source,
      truncated: false,
      latencyMs: Date.now() - started,
    })
  }
}

/** Fold conversation context into one scoring text, latest user utterance first. */
function contextQuery(context: readonly KbContextEntry[]): string {
  const lastUser = [...context].reverse().find(entry => entry.role === 'user')
  const rest = context
    .filter(entry => entry !== lastUser)
    .map(entry => entry.text)
    .join(' ')
  return lastUser === undefined ? rest : `${lastUser.text} ${rest}`
}

/** Validate and normalize an unknown `POST /search` response body. */
function normalizeHits(body: unknown): KbHit[] {
  if (typeof body !== 'object' || body === null || !('hits' in body)) {
    throw new RetrieverError('pre-retrieval: KB response missing hits array')
  }
  const raw = body.hits
  if (!Array.isArray(raw)) {
    throw new RetrieverError('pre-retrieval: KB response hits is not an array')
  }
  return raw.map((entry, index) => {
    const hit = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>
    return {
      doc_id: typeof hit.doc_id === 'string' ? hit.doc_id : `hit-${String(index)}`,
      title: typeof hit.title === 'string' ? hit.title : '',
      path: typeof hit.path === 'string' ? hit.path : '',
      snippet: typeof hit.snippet === 'string' ? hit.snippet : '',
      score: typeof hit.score === 'number' && Number.isFinite(hit.score) ? hit.score : 0,
      source: typeof hit.source === 'string' ? hit.source : 'docs',
    }
  })
}

/**
 * HTTP client for the internal knowledge base, speaking interface contract
 * v0.1 (`POST /search`). Failures throw {@link RetrieverError}; the plugin
 * treats them as a silent no-injection (with telemetry), never a task failure.
 */
export class HttpRetriever implements Retriever {
  readonly source = 'http'

  constructor(private readonly config: HttpRetrieverConfig) {}

  async retrieve(query: string, options: RetrieveOptions): Promise<RetrieveResult> {
    if (this.config.endpoint.length === 0) {
      throw new RetrieverError('pre-retrieval: http retriever configured without an endpoint')
    }
    const started = Date.now()
    const request: KbSearchRequest = {
      ...(query.length > 0 ? { query } : {}),
      ...(options.context !== undefined ? { context: options.context } : {}),
      top_k: options.topK,
      ...(options.sources !== undefined ? { sources: options.sources } : {}),
      ...(options.scope != null ? { scope: options.scope } : {}),
    }
    const timeoutMs = this.config.timeoutMs ?? 3000
    let response: Response
    try {
      response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.config.headers },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw new RetrieverError(
        `pre-retrieval: KB request failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      )
    }
    if (!response.ok) {
      throw new RetrieverError(`pre-retrieval: KB returned HTTP ${response.status}`)
    }
    let body: unknown
    try {
      body = await response.json()
    } catch (error) {
      throw new RetrieverError('pre-retrieval: KB returned a non-JSON response', { cause: error })
    }
    const hits = normalizeHits(body)
    const truncated = typeof body === 'object' && body !== null
      && 'truncated' in body && body.truncated === true
    return { hits, source: this.source, truncated, latencyMs: Date.now() - started }
  }
}
