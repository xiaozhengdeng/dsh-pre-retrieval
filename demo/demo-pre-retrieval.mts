/**
 * 绔埌绔紨绀猴細鐪熷疄 agent loop 涓紝棣栬疆妯″瀷璇锋眰蹇呴』鎼哄甫棰勬绱㈡敞鍏ュ潡銆? * 杩愯锛歝d deepseek-harness && pnpm exec tsx <姝ゆ枃浠?
 * 杈撳嚭锛氶杞姹傚畬鏁存枃鏈€佹敞鍏ヤ簨浠躲€佽疆娆＄粺璁°€? */
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

const adapter = new ScriptedAdapter([toolCallResponse(), textResponse('瀹屾垚銆?)])
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
  content: [{ type: 'text', text: '瀹炵幇璁¤垂妯″潡锛屽弬鐓у唴缃戣鑼? }],
  source: { kind: 'user' },
}))
await agent.whenIdle()

console.log('===== 杞缁熻 =====')
console.log(`妯″瀷璇锋眰鏁? ${adapter.requests.length}`)
console.log(`浼氳瘽浜嬩欢鎬绘暟: ${agent.session.events.length}`)
console.log()

const injections = agent.session.events.filter(
  event => event.type === 'user/message'
    && event.data.source.kind === 'plugin'
    && event.data.source.plugin === 'pre-retrieval')
console.log(`===== 娉ㄥ叆浜嬩欢锛堝簲鎭颁负 1 鏉★級=====`)
console.log(`娉ㄥ叆娆℃暟: ${injections.length}`)
console.log()

console.log('===== 棣栬疆妯″瀷璇锋眰 messages 閫愭潯 =====')
for (const [index, message] of adapter.requests[0]!.messages.entries()) {
  const text = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
  console.log(`--- message[${index}] role=${message.role} ---`)
  console.log(text.length > 3000 ? `${text.slice(0, 3000)}鈥?鎴柇)` : text)
  console.log()
}

console.log('===== 绗簩杞ā鍨嬭姹傦細娉ㄥ叆鍧楀簲浠嶅瓨鍦紙鍘嗗彶閲嶅彂锛岄噸澶嶈璐硅涔夛級=====')
const second = adapter.requests[1]!.messages
  .flatMap(m => m.content)
  .filter(b => b.type === 'text')
  .map(b => b.text)
  .join('\n')
console.log(`鍖呭惈棰勬绱㈠潡: ${second.includes('銆愰妫€绱㈣祫鏂?)}`)
console.log(`娉ㄥ叆瀛楃鏁? ${injections[0]!.data.content.find(b => b.type === 'text')?.text.length ?? 0}`)

await ctx.fiber.dispose()
