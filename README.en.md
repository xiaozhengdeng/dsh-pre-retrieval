# dsh-pre-retrieval Deliverables

Knowledge-base pre-retrieval plugin for DeepSeek Harness: before the first (or each) model request, fetch hits from the internal knowledge base with deterministic retrieval (0 tokens) and inject them into the context, moving "exploratory search" out of the LLM loop.

> 涓枃鐗? [README.md](README.md)

## Layout

```
dsh-pre-retrieval/
鈹溾攢鈹€ README.md              # This index
鈹溾攢鈹€ plugin/                # Plugin package source (mirror of DSH repo packages/context/pre-retrieval)
鈹?  鈹溾攢鈹€ src/               #   index (injection logic) / retriever (Mock+Http) / types (contract v0.2) / render / invariant
鈹?  鈹溾攢鈹€ tests/             #   22 test cases
鈹?  鈹溾攢鈹€ package.json       #   @deepseek-ai/dsh-pre-retrieval
鈹?  鈹溾攢鈹€ tsconfig.json
鈹?  鈹斺攢鈹€ README.md          #   Plugin usage docs (config / contract / behavior)
鈹溾攢鈹€ docs/
鈹?  鈹溾攢鈹€ design-plan.md     # Design plan (v0.2: context passing + incremental injection)
鈹?  鈹斺攢鈹€ verification-report.md  # Detailed verification report (22/22 tests + end-to-end evidence)
鈹斺攢鈹€ demo/
    鈹斺攢鈹€ demo-pre-retrieval.mts  # End-to-end demo script (real agent loop)
```

## Quick verification (must run inside the DSH repo)

The plugin is part of the DSH monorepo (it depends on `@deepseek-ai/cordis`, `dsh-agent`, and other workspace packages resolved through tsconfig paths), so it **cannot run standalone**. To integrate: put `plugin/` back at DSH repo `packages/context/pre-retrieval/`, then register it in the composition file (cordis.yml):

```yaml
- id: pre-retrieval
  name: '@deepseek-ai/dsh-pre-retrieval'
  config:
    retriever: mock          # switch to http + endpoint once the KB API exists
    queryMode: context       # context | rule
    injectMode: once         # once | per-turn
```

Verification commands (run in `deepseek-harness`):

```bash
pnpm vitest run packages/context/pre-retrieval
pnpm exec oxlint packages/context/pre-retrieval
pnpm exec tsc -b tsconfig.host.json
pnpm exec tsx <本仓库路径>\demo\demo-pre-retrieval.mts
```

## Key design decisions

| Decision | Description |
|---|---|
| Retrieval is 0 tokens | Retrieval is deterministic code; billing starts only when results enter the context, re-billed as length 脳 remaining rounds |
| Contract v0.2 | `POST /search` accepts `context` (conversation context for KB-side understanding) plus optional `query` (rule mode) |
| queryMode | `context` (default): hand bounded context to the KB; `rule`: plugin extracts keywords |
| injectMode | `once` (default): inject on the first turn only; `per-turn`: incremental per turn with doc_id de-duplication |
| Resume semantics | Injection state is rebuilt from the session log (`pre-retrieval-ids` meta section); resumes never re-inject |
| Silent degradation | Retrieval failures never block the task; once-mode marks the session, per-turn mode marks the turn |
| Budgets | Conservative defaults: `topK=3` / `maxChars=4000` / `minScore=0.2` / `contextMaxChars=2000` |

## Roadmap

- **M2**: once the KB HTTP endpoint exists, switch `retriever: http` (adaptation lives in `HttpRetriever`; align contract v0.2 per `docs/design-plan.md` 搂4.2);
- **M3**: mount the KB's MCP access surface via `@deepseek-ai/dsh-mcp-client` for on-demand in-loop retrieval, forming a dual path with pre-fetch.
