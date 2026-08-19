# @deepseek-ai/dsh-pre-retrieval

Knowledge-base pre-retrieval plugin: **before a model request is prepared**, fetch hits from the internal knowledge base with deterministic retrieval (0 tokens) and inject them into the context, so the agent works on retrieved facts instead of spending exploration turns searching for them.

**English** | [中文](README.md)

## Why it saves tokens

- Retrieval (vector DB / SQL / HTTP) is deterministic code: **0 tokens**;
- Injected results are re-billed as length × remaining rounds once they enter the context, so the defaults are deliberately conservative (`topK=3`, `maxChars=4000`, `minScore=0.2`);
- Exploration turns (guessing paths, reading whole files, trial-and-error searches) are the most expensive part on slow models; this plugin replaces them with pre-retrieval.

## Query modes

| Mode | Behavior | Use when |
|---|---|---|
| `queryMode: context` (default) | Hands **bounded conversation context** (pending messages + history highlights, `contextMaxChars=2000`) to the KB, which understands and retrieves | The KB can understand context; needs evolve with the conversation |
| `queryMode: rule` | The plugin slices the first `queryChars=800` chars of the task text as the query | The KB only accepts keyword queries |

## Injection modes

| Mode | Behavior | Use when |
|---|---|---|
| `injectMode: once` (default) | Inject once on the first turn, never again | The task's needs are known up front |
| `injectMode: per-turn` | Check every turn; inject only `doc_id`s **not injected before** | Long sessions, needs that arise mid-conversation |

per-turn de-duplication state is **rebuilt from the session log** (injected doc_ids ride a meta section on the injection message), so resumes never re-inject; once mode also decides from the session log.

## Installation

```yaml
# cordis.yml (existing DSH instance composition)
- id: pre-retrieval
  name: '@deepseek-ai/dsh-pre-retrieval'
  config:
    enabled: true
    retriever: mock          # switch to http once the KB endpoint exists
    queryMode: context       # context | rule
    injectMode: once         # once | per-turn
    topK: 3
    maxChars: 4000
    minScore: 0.2
```

`$DSH_HOME/settings.yaml` can hot-reload same-name fields without a restart:

```yaml
pre-retrieval:
  injectMode: per-turn
  contextMaxChars: 4000
```

## Configuration

| Field | Default | Description |
|---|---|---|
| `enabled` | `true` | Master switch |
| `retriever` | `mock` | `mock` (built-in samples, dev/verification) or `http` (real KB) |
| `queryMode` | `context` | `context`: hand conversation context to the KB; `rule`: plugin extracts a keyword query |
| `injectMode` | `once` | `once`: inject on the first turn only; `per-turn`: incremental per turn (doc_id de-dup) |
| `topK` | `3` | Max hits injected per turn |
| `maxChars` | `4000` | Hard budget for injected text in chars; truncates and flags |
| `minScore` | `0.2` | Hits below this score are dropped |
| `queryChars` | `800` | rule mode: leading chars of the task text used as the query |
| `contextMaxChars` | `2000` | context mode: total char budget of the context sent to the KB |
| `scope` | `null` | Retrieval scope forwarded verbatim (repo/team filters) |
| `http.endpoint` | `''` | Full `POST /search` URL (required when `retriever: http`) |
| `http.timeoutMs` | `3000` | Retrieval timeout; failures degrade silently (no injection, no task block) |
| `http.headers` | `{}` | Extra request headers (intranet auth) |

## Retrieval interface contract v0.2 (align with the KB team)

```http
POST {endpoint}
Content-Type: application/json

// context mode (query omitted; the KB understands the context)
{
  "context": [
    { "role": "user", "text": "实现计费模块，参照内网规范" },
    { "role": "assistant", "text": "好的，BillingService 是入口…" },
    { "role": "tool", "text": "读取了 billing/service.ts:42-90" }
  ],
  "top_k": 3,
  "sources": ["docs", "code"],
  "scope": { "repo": "billing" }
}

// rule mode (sends query)
{ "query": "实现计费模块，参照内网规范", "top_k": 3 }
```

```jsonc
// 200
{
  "hits": [
    { "doc_id": "…", "title": "…", "path": "…", "snippet": "≤500 chars", "score": 0.87, "source": "docs" }
  ],
  "truncated": false,
  "incremental": false   // optional: true = hits already de-duplicated against an earlier retrieval (the plugin de-dups by doc_id itself)
}
```

- `hits` must be relevance-descending; the plugin takes the top `topK` after `minScore` filtering, then de-duplicates by `doc_id` (per-turn mode);
- `snippet` should be ≤ 500 chars — it is re-billed every round once in context;
- Non-2xx / timeout / malformed responses → the plugin logs and does **not** inject; the task continues.

## Injected format

```
【预检索资料 · docs:2 code:1 · 来源 mock】
docs[1] 《计费系统架构》 src/architecture/billing.md
  月度计费入口 BillingService：订单结算 → 账单生成 → 对账，超时重试 3 次。
code[1] BillingService  src/billing/service.ts:42
  class BillingService(apiKey) — 月度计费入口。refs: 17
```

## Behavior and invariants

- **At most one injection per turn** (step 1); once mode at most one per session; per-turn mode incremental with unique doc_ids;
- Injection is a plugin-sourced user message (`source.kind: 'plugin'`) with a `form: 'snapshot'` main section plus a `pre-retrieval-ids` meta section (records doc_ids for resume de-dup);
- Session state (already injected? which doc_ids?) is **rebuilt from the session log**, not process memory — consistent across resumes;
- Failures: once mode marks the session done, per-turn mode marks the turn (next turn may retry); both degrade silently;
- Telemetry: `[pre-retrieval] injected {chars} chars, {hits} hits, {latencyMs}ms, truncated={bool}, mode={queryMode}/{injectMode}`.

## Tests

```bash
pnpm vitest run packages/context/pre-retrieval
```

Coverage (22 cases): mock CJK keyword/bigram scoring, HTTP contract v0.2 (context body / normalization / errors / network-failure degradation), render budget truncation, first-turn injection, once multi-turn persistence, per-turn increments with doc_id de-dup, resume (once no re-inject, per-turn id rebuild), multi-agent failure isolation, and a real agent loop carrying the injection in the first request.

## Roadmap (M2/M3)

- **M2**: once the KB HTTP endpoint exists, switch `retriever: http` and fill `endpoint` (all adaptation lives in `HttpRetriever`; align contract v0.2);
- **M3**: mount the KB's MCP access surface via `@deepseek-ai/dsh-mcp-client` for on-demand in-loop retrieval, forming a dual path with pre-fetch.
