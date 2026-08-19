/** Package-owned durable pre-retrieval invariants. @module @deepseek-ai/dsh-pre-retrieval/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-pre-retrieval'
const SOURCE_NAME = 'pre-retrieval'
const IDS_SECTION = 'pre-retrieval-ids'
const HEADER_PREFIX = '【预检索资料'

/** Cordis companion plugin name. */
export const name = 'pre-retrieval-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** The open turn owning a user message, when determinable from history. */
function owningTurn(history: readonly SessionEvent[]): number | undefined {
  let openTurn: number | undefined
  for (const prior of history) {
    if (prior.type === 'turn/start') openTurn = prior.data.turn
    if (prior.type === 'turn/end') openTurn = undefined
  }
  return openTurn
}

/** Validate one plugin-attributed injection message against the durable format. */
function validateInjection(
  history: readonly SessionEvent[],
  event: SessionEvent<'user/message'>,
  fail: InvariantFailure,
): void {
  const blockValue: unknown = event.data.content[0]
  const block = typeof blockValue === 'object' && blockValue !== null
    ? blockValue as Record<string, unknown>
    : undefined
  const blockText = block?.text
  if (event.data.content.length !== 1
    || block === undefined
    || Object.keys(block).length !== 2
    || block.type !== 'text'
    || typeof blockText !== 'string') {
    fail('pre-retrieval messages must contain exactly one text block')
  }
  if (!blockText.startsWith(HEADER_PREFIX)) {
    fail('pre-retrieval message must start with the attributed header')
  }
  const source = event.data.source
  /* v8 ignore next 2 -- replay and dispatch callers select this exact package-owned source before validation. */
  if (source.kind !== 'plugin' || source.plugin !== SOURCE_NAME) {
    fail('pre-retrieval source must retain package ownership')
  }
  const sections: unknown = 'sections' in source ? source.sections : undefined
  if (source.form !== 'snapshot'
    || !Array.isArray(sections)
    || sections.length < 1
    || sections.length > 2) {
    fail('pre-retrieval source must carry a snapshot with one text section and an optional ids section')
  }
  const mainValue: unknown = sections[0]
  const main = typeof mainValue === 'object' && mainValue !== null
    ? mainValue as Record<string, unknown>
    : undefined
  if (main === undefined
    || Object.keys(main).length !== 2
    || main.name !== SOURCE_NAME
    || main.text !== blockText) {
    fail('pre-retrieval source must carry only the exact snapshot text, not request authority')
  }
  if (sections.length === 2) {
    const idsValue: unknown = sections[1]
    const ids = typeof idsValue === 'object' && idsValue !== null
      ? idsValue as Record<string, unknown>
      : undefined
    if (ids === undefined
      || Object.keys(ids).length !== 2
      || ids.name !== IDS_SECTION
      || typeof ids.text !== 'string'
      || ids.text.split(',').some(id => id.length === 0)) {
      fail('pre-retrieval ids section must be a comma-separated list of non-empty doc_ids')
    }
  }
  // At most one injection per turn: once-mode injects once overall (a stricter
  // subset), per-turn mode injects at most once per turn, never per step.
  const turn = owningTurn(history)
  if (turn !== undefined) {
    const sameTurn = history.filter((prior): prior is SessionEvent<'user/message'> =>
      prior.type === 'user/message'
      && prior.data.source.kind === 'plugin'
      && prior.data.source.plugin === SOURCE_NAME)
      .filter(prior => owningTurn(history.slice(0, history.indexOf(prior))) === turn)
    if (sameTurn.length > 0) {
      fail(`pre-retrieval must inject at most once per turn (turn ${String(turn)} has more)`)
    }
  }
}

/* jscpd:ignore-start -- package companions share replay and dispatch plumbing */
/** Validate all package-owned injections already present in one session. */
function validateSession(session: Session, fail: InvariantFailure): void {
  for (const [index, event] of session.events.entries()) {
    if (event.type !== 'user/message'
      || event.data.source.kind !== 'plugin'
      || event.data.source.plugin !== SOURCE_NAME) continue
    validateInjection(session.events.slice(0, index), event, fail)
  }
}

/** Install validation for loaded and newly appended injection messages. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) validateSession(session, fail)
  ctx.on('session/created', (session) => { validateSession(session, fail) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    if (event.type !== 'user/message'
      || event.data.source.kind !== 'plugin'
      || event.data.source.plugin !== SOURCE_NAME) return
    validateInjection(session.events, event, fail)
  }, { global: true })
}, { inject: ['sessions'] })
/* jscpd:ignore-end */

/**
 * Register the pre-retrieval invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
