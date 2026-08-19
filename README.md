# dsh-pre-retrieval

**English** | [中文 ↓](#zh)

Knowledge-base pre-retrieval plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): before the first (or each) model request, fetch hits from the internal knowledge base with deterministic retrieval (0 tokens) and inject them into the context, moving "exploratory search" out of the LLM loop.

## Layout

```
dsh-pre-retrieval/
|-- README.md               # Bilingual index (English above, 中文 below)
|-- plugin/                 # Plugin package source (mirror of DSH repo packages/context/pre-retrieval)
|   |-- src/                #   index (injection logic) / retriever (Mock+Http) / types (contract v0.2) / render / invariant
|   |-- tests/              #   22 test cases
|   |-- package.json        #   @deepseek-ai/dsh-pre-retrieval
|   |-- tsconfig.json
|   `-- README.md           #   Plugin usage docs (config / contract / behavior)
|-- docs/
|   |-- design-plan.md      # Design plan (v0.2: context passing + incremental injection)
|   `-- verification-report.md  # Detailed verification report (22/22 tests + end-to-end evidence)
`-- demo/
    `-- demo-pre-retrieval.mts  # End-to-end demo script (real agent loop)
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

Verification commands (run in the `deepseek-harness` repo root):

```bash
pnpm vitest run packages/context/pre-retrieval
pnpm exec oxlint packages/context/pre-retrieval
pnpm exec tsc -b tsconfig.host.json
pnpm exec tsx <path-to-this-repo>/demo/demo-pre-retrieval.mts
```

## Key design decisions

| Decision | Description |
|---|---|
| Retrieval is 0 tokens | Retrieval is deterministic code; billing starts only when results enter the context, re-billed as length x remaining rounds |
| Contract v0.2 | `POST /search` accepts `context` (conversation context for KB-side understanding) plus optional `query` (rule mode) |
| queryMode | `context` (default): hand bounded context to the KB; `rule`: plugin extracts keywords |
| injectMode | `once` (default): inject on the first turn only; `per-turn`: incremental per turn with doc_id de-duplication |
| Resume semantics | Injection state is rebuilt from the session log (`pre-retrieval-ids` meta section); resumes never re-inject |
| Silent degradation | Retrieval failures never block the task; once-mode marks the session, per-turn mode marks the turn |
| Budgets | Conservative defaults: `topK=3` / `maxChars=4000` / `minScore=0.2` / `contextMaxChars=2000` |

## Roadmap

- **M2**: once the KB HTTP endpoint exists, switch `retriever: http` (adaptation lives in `HttpRetriever`; align contract v0.2 per `docs/design-plan.md` section 4.2);
- **M3**: mount the KB's MCP access surface via `@deepseek-ai/dsh-mcp-client` for on-demand in-loop retrieval, forming a dual path with pre-fetch.

---

<a id="zh"></a>

## 中文版

[English ↑](#dsh-pre-retrieval)

知识库前置检索插件（[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)）：首轮/每轮模型请求前用确定性检索（0 token）从内部知识库取回命中并注入上下文，把"探索性检索"从 LLM 循环中移除。

### 目录结构

```
dsh-pre-retrieval/
|-- README.md               # 双语索引（英文在上，中文在下）
|-- plugin/                 # 插件包源码（对应 DSH 仓库 packages/context/pre-retrieval）
|   |-- src/                #   index(注入逻辑) / retriever(Mock+Http) / types(契约v0.2) / render / invariant
|   |-- tests/              #   22 个测试用例
|   |-- package.json        #   @deepseek-ai/dsh-pre-retrieval
|   |-- tsconfig.json
|   `-- README.md           #   插件使用文档（配置/契约/行为）
|-- docs/
|   |-- design-plan.md      # 设计方案（v0.2：上下文传递 + 增量注入）
|   `-- verification-report.md  # 详细验证报告（22/22 测试 + 端到端证据）
`-- demo/
    `-- demo-pre-retrieval.mts  # 端到端演示脚本（真实 agent loop）
```

### 快速验证（需在 DSH 仓库环境内运行）

插件是 DSH monorepo 的一部分（依赖 `@deepseek-ai/cordis`、`dsh-agent` 等 workspace 包与 tsconfig paths 解析），**不能脱离 DSH 仓库独立运行**。集成方式：把 `plugin/` 放回 DSH 仓库 `packages/context/pre-retrieval/`，然后在组合文件（cordis.yml）注册：

```yaml
- id: pre-retrieval
  name: '@deepseek-ai/dsh-pre-retrieval'
  config:
    retriever: mock          # 知识库接口提供后切 http + 填 endpoint
    queryMode: context       # context | rule
    injectMode: once         # once | per-turn
```

验证命令（在 `deepseek-harness` 仓库根目录执行）：

```bash
pnpm vitest run packages/context/pre-retrieval
pnpm exec oxlint packages/context/pre-retrieval
pnpm exec tsc -b tsconfig.host.json
pnpm exec tsx <本仓库路径>/demo/demo-pre-retrieval.mts
```

### 关键设计决策

| 决策 | 说明 |
|---|---|
| 检索 0 token | 检索是确定性代码；结果入上下文后才计费，按「长度 × 剩余轮次」重复计费 |
| 契约 v0.2 | `POST /search` 支持 `context`（会话上下文交给知识库理解）+ 可选 `query`（rule 模式） |
| queryMode | `context`（默认）：把有界上下文交给知识库；`rule`：插件提取关键词 |
| injectMode | `once`（默认）首轮一次；`per-turn` 每轮增量、doc_id 去重 |
| resume 语义 | 注入状态从会话日志重建（`pre-retrieval-ids` meta section），恢复不重复注入 |
| 静默降级 | 检索失败不注入、不阻塞任务；once 失败标记会话、per-turn 失败标记本轮 |
| 预算 | `topK=3` / `maxChars=4000` / `minScore=0.2` / `contextMaxChars=2000` 默认保守 |

### 后续

- **M2**：知识库 HTTP 接口提供后 `retriever: http`（适配层集中在 `HttpRetriever`，契约 v0.2 对齐，见 `docs/design-plan.md` §4.2）；
- **M3**：知识库 MCP 访问面挂 `@deepseek-ai/dsh-mcp-client`，循环内按需补取，与预取形成双链路。
