import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId, createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import AgentRegistry, { agentEvents, Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as preRetrieval from '@deepseek-ai/dsh-pre-retrieval'
import type { Config } from '@deepseek-ai/dsh-pre-retrieval'
import { HttpRetriever, MockRetriever } from '@deepseek-ai/dsh-pre-retrieval'
import { RetrieverError } from '@deepseek-ai/dsh-pre-retrieval'

const SIGNAL = new AbortController().signal

async function mount(config: Config = {}): Promise<{ ctx: Context }> {
  const ctx = new Context()
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(preRetrieval, config)
  return { ctx }
}

function sessionAgent(session: Session, id = 'agent'): Agent {
  return {
    id: SessionId(id),
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'running',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel() {},
    runMaintenance: <T>(task: (signal: AbortSignal) => Promise<T>) => task(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

function openMessageTurn(session: Session, turn: number, text = 'turn message'): void {
  session.append('turn/start', { turn })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
}

/** Collect this plugin's injected texts from the session log. */
function injectedTexts(session: Session): string[] {
  const texts: string[] = []
  for (const event of session.events) {
    if (event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === 'pre-retrieval') {
      texts.push(event.data.content.find(block => block.type === 'text')?.text ?? '')
    }
  }
  return texts
}

async function fire(
  ctx: Context,
  agent: Agent,
  turn: number,
  step: number,
  messageText = '实现计费模块，参照内网规范',
  signal: AbortSignal = SIGNAL,
): Promise<void> {
  const proposed = createUserMessage({
    content: [{ type: 'text', text: messageText }],
    source: { kind: 'user' },
  })
  const decision = await agentEvents(ctx, agent).waterfall(
    'agent/pre-step',
    { messages: [proposed], turn, step, signal },
    () => Promise.resolve({ kind: 'enter' as const, messages: [proposed] }),
  )
  if (decision.kind === 'enter') {
    for (const message of decision.messages) {
      if (message === proposed) continue
      agent.session.append('user/message', message, { surfaceOp: 'append' })
    }
  }
}

describe('MockRetriever', () => {
  it('scores keyword hits and caps at topK, ordered by score', async () => {
    const retriever = new MockRetriever()
    const result = await retriever.retrieve('计费', { topK: 2 })
    expect(result.source).toBe('mock')
    expect(result.hits).toHaveLength(2)
    expect(result.hits[0]!.title).toContain('计费')
    expect(result.hits[0]!.score).toBeGreaterThanOrEqual(result.hits[1]!.score)
  })

  it('returns the default ranking when the query has no terms', async () => {
    const retriever = new MockRetriever()
    const result = await retriever.retrieve('   ', { topK: 3 })
    expect(result.hits).toHaveLength(3)
  })
})

describe('HttpRetriever', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts the contract body and normalizes hits', async () => {
    let captured: { url: string; init: RequestInit } | undefined
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, init }
      return new Response(JSON.stringify({
        hits: [{ doc_id: 'a', title: 'T', path: 'p', snippet: 's', score: 0.9, source: 'docs' }],
      }), { status: 200 })
    }))
    const retriever = new HttpRetriever({ endpoint: 'http://kb.internal/search', timeoutMs: 500 })
    const result = await retriever.retrieve('query text', { topK: 2, scope: { repo: 'billing' } })

    expect(captured?.url).toBe('http://kb.internal/search')
    expect(captured?.init?.method).toBe('POST')
    const rawBody = captured?.init?.body
    const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '') as Record<string, unknown>
    expect(body).toEqual({ query: 'query text', top_k: 2, scope: { repo: 'billing' } })
    expect(result.hits).toEqual([
      { doc_id: 'a', title: 'T', path: 'p', snippet: 's', score: 0.9, source: 'docs' },
    ])
    expect(result.source).toBe('http')
  })

  it('throws RetrieverError on a non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))
    const retriever = new HttpRetriever({ endpoint: 'http://kb.internal/search' })
    await expect(retriever.retrieve('q', { topK: 1 })).rejects.toThrow(RetrieverError)
  })

  it('throws RetrieverError when the response lacks a hits array', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ nope: true }), { status: 200 })))
    const retriever = new HttpRetriever({ endpoint: 'http://kb.internal/search' })
    await expect(retriever.retrieve('q', { topK: 1 })).rejects.toThrow(/missing hits/)
  })

  it('throws RetrieverError when configured without an endpoint', async () => {
    const retriever = new HttpRetriever({ endpoint: '' })
    await expect(retriever.retrieve('q', { topK: 1 })).rejects.toThrow(/without an endpoint/)
  })
})

describe('renderInjection', () => {
  const hits = [
    { doc_id: 'a', title: '标题A', path: 'p/a.md', snippet: '片段A', score: 0.9, source: 'docs' },
    { doc_id: 'b', title: 'SymbolB', path: 'p/b.ts:3', snippet: '片段B', score: 0.8, source: 'code' },
  ]

  it('renders an attributed header with per-source counts', () => {
    const { text, truncated } = preRetrieval.renderInjection({ source: 'mock' }, hits, 4000)
    expect(truncated).toBe(false)
    expect(text).toContain('【预检索资料 · docs:1 code:1 · 来源 mock】')
    expect(text).toContain('docs[1] 《标题A》 p/a.md')
    expect(text).toContain('code[2] 《SymbolB》 p/b.ts:3')
  })

  it('truncates to the character budget and marks the result', () => {
    const { text, truncated, chars } = preRetrieval.renderInjection({ source: 'mock' }, hits, 40)
    expect(truncated).toBe(true)
    expect(chars).toBeLessThanOrEqual(40)
    expect(text.endsWith('…')).toBe(true)
  })
})

describe('pre-retrieval injection', () => {
  it('injects retrieved hits into the first step and marks the session', async () => {
    const { ctx } = await mount({ topK: 2, minScore: 0.2 })
    const session = Session.create(SessionId('first'))
    const agent = sessionAgent(session)
    openMessageTurn(session, 1, '实现计费模块')

    await fire(ctx, agent, 1, 1)

    const texts = injectedTexts(session)
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('【预检索资料')
    expect(texts[0]).toContain('计费')

    const event = session.events.at(-1)
    expect(event?.type).toBe('user/message')
    if (event?.type !== 'user/message') throw new Error('missing injection')
    const source = event.data.source
    expect(source.kind).toBe('plugin')
    if (source.kind !== 'plugin') throw new Error('not a plugin source')
    expect(source.plugin).toBe('pre-retrieval')
    expect(source.form).toBe('snapshot')
    if (!('sections' in source)) throw new Error('missing sections')
    const sections = (source as { sections: readonly { name: string; text: string }[] }).sections
    expect(sections[0]).toEqual({ name: 'pre-retrieval', text: texts[0] })
    // Resume-safe de-duplication: injected doc_ids ride a meta section.
    const idsSection = sections[1]
    expect(idsSection?.name).toBe('pre-retrieval-ids')
    const ids = (idsSection?.text ?? '').split(',')
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.every(id => id.length > 0)).toBe(true)
    expect(event.surfaceOp).toBe('append')
  })

  it('injects only once per session across later steps and turns', async () => {
    const { ctx } = await mount()
    const session = Session.create(SessionId('once'))
    const agent = sessionAgent(session)
    openMessageTurn(session, 1)

    await fire(ctx, agent, 1, 1)
    await fire(ctx, agent, 1, 2)
    await fire(ctx, agent, 2, 1)

    expect(injectedTexts(session)).toHaveLength(1)
  })

  it('injects nothing when disabled', async () => {
    const { ctx } = await mount({ enabled: false })
    const session = Session.create(SessionId('disabled'))
    const agent = sessionAgent(session)
    openMessageTurn(session, 1)

    await fire(ctx, agent, 1, 1)

    expect(injectedTexts(session)).toHaveLength(0)
  })

  it('injects nothing when no hit passes minScore', async () => {
    const { ctx } = await mount({ minScore: 0.99 })
    const session = Session.create(SessionId('filtered'))
    const agent = sessionAgent(session)
    openMessageTurn(session, 1)

    await fire(ctx, agent, 1, 1)

    expect(injectedTexts(session)).toHaveLength(0)
  })

  it('respects the character budget end to end', async () => {
    const { ctx } = await mount({ maxChars: 80 })
    const session = Session.create(SessionId('budget'))
    const agent = sessionAgent(session)
    openMessageTurn(session, 1)

    await fire(ctx, agent, 1, 1)

    const texts = injectedTexts(session)
    expect(texts).toHaveLength(1)
    expect(texts[0]!.length).toBeLessThanOrEqual(80)
    expect(texts[0]!.endsWith('…')).toBe(true)
  })

  it('does not inject on non-first steps', async () => {
    const { ctx } = await mount()
    const session = Session.create(SessionId('later-step'))
    const agent = sessionAgent(session)
    openMessageTurn(session, 1)

    await fire(ctx, agent, 1, 2)

    expect(injectedTexts(session)).toHaveLength(0)
  })
})

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCallResponse(): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    {
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: CallId('tick-1'), name: 'tick', arguments: '{}' },
    },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

class ScriptedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private readonly script: StreamChunk[][]) {
    super()
  }

  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const chunks = this.script.shift()
    if (chunks === undefined) throw new Error('ScriptedAdapter: script exhausted')
    for (const chunk of chunks) yield chunk
  }
}

function requestText(request: GenerateOptions): string {
  return request.messages
    .flatMap(message => message.content)
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

describe('context mode and per-turn injection', () => {
  it('sends conversation context in the HTTP request body (v0.2)', async () => {
    let captured: { init: RequestInit } | undefined
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = { init }
      return new Response(JSON.stringify({ hits: [] }), { status: 200 })
    }))
    const retriever = new HttpRetriever({ endpoint: 'http://kb.internal/search' })
    await retriever.retrieve('', {
      topK: 2,
      context: [
        { role: 'user', text: '实现计费' },
        { role: 'assistant', text: '好的' },
      ],
    })
    const rawBody = captured?.init?.body
    const body = JSON.parse(typeof rawBody === 'string' ? rawBody : '') as Record<string, unknown>
    // Empty rule query is omitted; the KB understands the context alone.
    expect(body.query).toBeUndefined()
    expect(body.context).toEqual([
      { role: 'user', text: '实现计费' },
      { role: 'assistant', text: '好的' },
    ])
    expect(body.top_k).toBe(2)
  })

  it('injects once across multiple user turns in once mode', async () => {
    const { ctx } = await mount()
    const session = Session.create(SessionId('multi'))
    const agent = sessionAgent(session)
    openMessageTurn(session, 1, '实现计费模块')
    await fire(ctx, agent, 1, 1, '实现计费模块')
    openMessageTurn(session, 2, '写部署规范')
    await fire(ctx, agent, 2, 1, '写部署规范')
    openMessageTurn(session, 3, '整理 token 实践')
    await fire(ctx, agent, 3, 1, '整理 token 实践')

    expect(injectedTexts(session)).toHaveLength(1)
  })

  it('per-turn mode injects fresh hits on later turns without repeating doc_ids', async () => {
    const { ctx } = await mount({ injectMode: 'per-turn', minScore: 0.2, topK: 3 })
    const session = Session.create(SessionId('perturn'))
    const agent = sessionAgent(session)
    openMessageTurn(session, 1, '实现计费模块')
    await fire(ctx, agent, 1, 1, '实现计费模块')
    const firstText = injectedTexts(session)[0]
    expect(firstText).toContain('计费系统架构')

    // 第二轮新需求：模型服务部署规范 → 注入新 doc，已注入的 billing 不重复
    openMessageTurn(session, 2, '同时把模型服务部署规范也整理一下')
    await fire(ctx, agent, 2, 1, '同时把模型服务部署规范也整理一下')

    const texts = injectedTexts(session)
    expect(texts).toHaveLength(2)
    expect(texts[1]).toContain('内网模型服务部署规范')
    expect(texts[1]).not.toContain('计费系统架构')

    // doc_id 全局唯一：ids section 重建 + 去重生效
    const injectedEvents = session.events.filter(
      (event): event is SessionEvent<'user/message'> =>
        event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === 'pre-retrieval')
    const allIds = injectedEvents.flatMap(event =>
      'sections' in event.data.source
        ? event.data.source.sections
          .filter(section => section.name === 'pre-retrieval-ids')
          .flatMap(section => section.text.split(','))
        : [])
    expect(allIds.length).toBeGreaterThan(0)
    expect(new Set(allIds).size).toBe(allIds.length)
  })

  it('does not re-inject after resume in once mode', async () => {
    const { ctx } = await mount({ injectMode: 'once' })
    const session = Session.create(SessionId('resume'))
    const agent = sessionAgent(session)
    openMessageTurn(session, 1, '实现计费模块')
    await fire(ctx, agent, 1, 1, '实现计费模块')
    expect(injectedTexts(session)).toHaveLength(1)

    // 模拟恢复：新插件实例 + 同一 session → 不重复注入
    const ctx2 = new Context()
    await ctx2.plugin(AgentRegistry)
    await ctx2.plugin(preRetrieval, { injectMode: 'once' })
    const resumed = sessionAgent(session, 'resumed')
    openMessageTurn(session, 2, '继续实现计费')
    await fire(ctx2, resumed, 2, 1, '继续实现计费')

    expect(injectedTexts(session)).toHaveLength(1)
  })

  it('reconstructs injected doc_ids from the session log after resume (per-turn)', async () => {
    const session = Session.create(SessionId('resume-perturn'))
    openMessageTurn(session, 1, '开始')
    // 模拟恢复前已注入 billing-001（ids 记录在 meta section）
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '【预检索资料 · docs:1 · 来源 mock】\n已注入计费' }],
      source: {
        kind: 'plugin',
        plugin: 'pre-retrieval',
        form: 'snapshot',
        sections: [
          { name: 'pre-retrieval', text: '【预检索资料 · docs:1 · 来源 mock】\n已注入计费' },
          { name: 'pre-retrieval-ids', text: 'mock-billing-001' },
        ],
      },
    }), { surfaceOp: 'append' })

    const { ctx } = await mount({ injectMode: 'per-turn', minScore: 0.2 })
    const agent = sessionAgent(session, 'resumed')
    openMessageTurn(session, 2, '同时把模型服务部署规范也整理一下')
    await fire(ctx, agent, 2, 1, '同时把模型服务部署规范也整理一下')

    const texts = injectedTexts(session)
    expect(texts).toHaveLength(2)
    expect(texts[1]).toContain('内网模型服务部署规范')
    // 新注入的 ids 不含已注入的 billing-001
    const last = session.events.at(-1)
    if (last?.type !== 'user/message' || !('sections' in last.data.source)) {
      throw new Error('missing ids section')
    }
    const idsText = last.data.source.sections.find(section => section.name === 'pre-retrieval-ids')?.text ?? ''
    expect(idsText.split(',')).not.toContain('mock-billing-001')
  })

  it('degrades silently when the HTTP request throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down')
    }))
    const { ctx } = await mount({ retriever: 'http', http: { endpoint: 'http://kb.internal/search' } })
    const session = Session.create(SessionId('http-throw'))
    const agent = sessionAgent(session)
    openMessageTurn(session, 1, '实现计费模块')

    await fire(ctx, agent, 1, 1) // 不抛异常

    expect(injectedTexts(session)).toHaveLength(0)
  })

  it('isolates failure state per agent', async () => {
    let fail = true
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (fail) throw new Error('network down')
      return new Response(JSON.stringify({
        hits: [{ doc_id: 'x', title: 'T', path: 'p', snippet: 's', score: 0.9, source: 'docs' }],
      }), { status: 200 })
    }))
    const { ctx } = await mount({
      retriever: 'http',
      http: { endpoint: 'http://kb.internal/search' },
      minScore: 0.2,
    })
    const sessionA = Session.create(SessionId('a'))
    const agentA = sessionAgent(sessionA, 'a')
    openMessageTurn(sessionA, 1, '实现计费模块')
    await fire(ctx, agentA, 1, 1, '实现计费模块')
    expect(injectedTexts(sessionA)).toHaveLength(0)

    fail = false
    const sessionB = Session.create(SessionId('b'))
    const agentB = sessionAgent(sessionB, 'b')
    openMessageTurn(sessionB, 1, '实现计费模块')
    await fire(ctx, agentB, 1, 1, '实现计费模块')
    expect(injectedTexts(sessionB)).toHaveLength(1)
  })
})

describe('real agent-loop request history', () => {
  it('carries the pre-retrieved context into the model request and injects only once', async () => {
    const adapter = new ScriptedAdapter([toolCallResponse(), textResponse('完成。')])
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(preRetrieval, { retriever: 'mock', topK: 3, minScore: 0.2 })
    ctx.tools.register(defineContentToolFixture({
      name: 'tick',
      description: 'advance the script',
      parameters: {},
      async execute() {
        return [{ type: 'text' as const, text: 'ok' }]
      },
    }))
    ctx.llm.registerAdapter(['mock'], adapter)
    const agent = ctx.agentLoop.create(SessionId('loop'), { provider: 'mock', model: 'mock' })

    agent.followup(createUserMessage({
      content: [{ type: 'text', text: '实现计费模块，参照内网规范' }],
      source: { kind: 'user' },
    }))
    await agent.whenIdle()

    expect(adapter.requests).toHaveLength(2)
    const first = requestText(adapter.requests[0]!)
    const second = requestText(adapter.requests[1]!)
    expect(first).toContain('【预检索资料')
    expect(first).toContain('计费系统架构')
    // Later rounds re-send the same injected block from history (re-billed),
    // never a second fresh injection.
    expect(second).toContain('【预检索资料')
    const injections = agent.session.events.filter(
      (event): event is SessionEvent<'user/message'> =>
        event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === 'pre-retrieval',
    )
    expect(injections).toHaveLength(1)
    await ctx.fiber.dispose()
  })
})
