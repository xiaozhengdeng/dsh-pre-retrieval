/**
 * 端到端演示：真实 agent loop 中，首轮模型请求必须携带预检索注入块。
 * 运行：cd deepseek-harness && pnpm exec tsx <此文件>
 * 输出：首轮请求完整文本、注入事件、轮次统计。
 */
import { Context } from '@deepseek-ai/cordis'
import { CallId, createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as preRetrieval from '@deepseek-ai/dsh-pre-retrieval'

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
  constructor(private readonly script: StreamChunk[][]) { super() }
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const chunks = this.script.shift()
    if (chunks === undefined) throw new Error('ScriptedAdapter: script exhausted')
    for (const chunk of chunks) yield chunk
  }
}

const adapter = new ScriptedAdapter([toolCallResponse(), textResponse('完成。')])
const ctx = new Context()
await mountAgentLoopTestDependencies(ctx)
await ctx.plugin(AgentLoop, { agents: [] })
await ctx.plugin(preRetrieval, { retriever: 'mock', topK: 3, minScore: 0.2, maxChars: 4000 })
ctx.tools.register(defineContentToolFixture({
  name: 'tick', description: 'advance the script', parameters: {},
  async execute() { return [{ type: 'text' as const, text: 'ok' }] },
}))
ctx.llm.registerAdapter(['mock'], adapter)
const agent = ctx.agentLoop.create(SessionId('demo'), { provider: 'mock', model: 'mock' })

agent.followup(createUserMessage({
  content: [{ type: 'text', text: '实现计费模块，参照内网规范' }],
  source: { kind: 'user' },
}))
await agent.whenIdle()

console.log('===== 轮次统计 =====')
console.log(`模型请求数: ${adapter.requests.length}`)
console.log(`会话事件总数: ${agent.session.events.length}`)
console.log()

const injections = agent.session.events.filter(
  event => event.type === 'user/message'
    && event.data.source.kind === 'plugin'
    && event.data.source.plugin === 'pre-retrieval')
console.log(`===== 注入事件（应恰为 1 条）=====`)
console.log(`注入次数: ${injections.length}`)
console.log()

console.log('===== 首轮模型请求 messages 逐条 =====')
for (const [index, message] of adapter.requests[0]!.messages.entries()) {
  const text = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
  console.log(`--- message[${index}] role=${message.role} ---`)
  console.log(text.length > 3000 ? `${text.slice(0, 3000)}…(截断)` : text)
  console.log()
}

console.log('===== 第二轮模型请求：注入块应仍存在（历史重发，重复计费语义）=====')
const second = adapter.requests[1]!.messages
  .flatMap(m => m.content)
  .filter(b => b.type === 'text')
  .map(b => b.text)
  .join('\n')
console.log(`包含预检索块: ${second.includes('【预检索资料')}`)
console.log(`注入字符数: ${injections[0]!.data.content.find(b => b.type === 'text')?.text.length ?? 0}`)

await ctx.fiber.dispose()
