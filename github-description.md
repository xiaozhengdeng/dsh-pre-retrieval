# GitHub 仓库描述文案包（dsh-pre-retrieval）

以下内容可直接复制粘贴到 GitHub 仓库设置 / 首页 / Release。

---

## 1. Repository Description（仓库 About 字段，一行，≤350 字符）

**英文版（推荐，GitHub 通用）：**

> Pre-retrieval context injection for DeepSeek Harness: deterministic 0-token KB retrieval before the first model request, injected once — eliminates exploration turns and cuts token spend on slow intranet models.

**中文版：**

> DeepSeek Harness 知识库前置检索插件：首轮模型请求前用确定性检索（0 token）取回知识库命中并注入上下文，消除探索性检索轮次，为内网慢模型大幅节省 token。

---

## 2. 仓库首页简介（About 区的详细描述 / 置顶段落）

**英文版：**

> `dsh-pre-retrieval` is a plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) that moves knowledge lookup out of the LLM loop. Before the first (or each) model request it retrieves knowledge-base hits with deterministic code (0 tokens) and injects the top results once, so the agent works on retrieved facts instead of guessing paths, reading whole files, or trial-and-error searching.
>
> - **0-token retrieval**: the search itself is deterministic; billing starts only when results enter the context
> - **Context passing (contract v0.2)**: hands bounded conversation context to the KB for understanding (`context` mode), or a keyword query (`rule` mode)
> - **once / per-turn injection**: first-turn only, or incremental per turn with `doc_id` de-duplication
> - **Resume-safe**: injection state is rebuilt from the session log, never re-injected after resume
> - **Silent degradation**: retrieval failures never block the task
> - Built for intranet deployments where external models are unreachable and self-hosted models are slow and token-expensive

**中文版：**

> `dsh-pre-retrieval` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的插件，把知识检索从 LLM 循环中整体移除：在首轮（或每轮）模型请求前，用确定性代码（0 token）从知识库取回命中并一次性注入上下文，让 agent 在检索结果之上工作——不再猜路径、读整文件、反复试搜。
>
> - **检索 0 token**：检索是确定性执行；结果进入上下文才计费
> - **上下文传递（契约 v0.2）**：把有界会话上下文交给知识库理解（`context` 模式），或发送关键词查询（`rule` 模式）
> - **once / per-turn 注入**：仅首轮注入，或每轮增量注入并按 `doc_id` 去重
> - **恢复安全**：注入状态从会话日志重建，恢复会话不重复注入
> - **静默降级**：检索失败绝不阻塞任务
> - 面向内网部署：连不到外部模型、自部署模型慢且 token 昂贵

---

## 3. Topics（仓库标签，最多 20 个）

```
dsh-plugin
deepseek-harness
llm
rag
pre-retrieval
token-saving
knowledge-base
context-injection
coding-agent
intranet
retrieval-augmented
```
（按需增删；推荐至少保留前 8 个）

---

## 4. Release 草稿（v0.1.0）

**标题：** `v0.1.0 — pre-retrieval context injection`

**英文版正文：**

> ### Highlights
> - Deterministic 0-token knowledge-base retrieval injected before the first model request
> - Contract v0.2: conversation `context` passing for KB-side understanding, plus keyword `query` (rule) mode
> - `once` (first turn) and `per-turn` (incremental, `doc_id` de-duplicated) injection modes
> - Resume-safe injection state rebuilt from the session log (`pre-retrieval-ids` meta section)
> - Silent degradation: retrieval failures never block the task
> - Mock retriever for development/verification; HTTP retriever implements the v0.2 contract (endpoint configurable)
> - Budgets: `topK=3`, `maxChars=4000`, `minScore=0.2`, `contextMaxChars=2000`
>
> ### Verification
> - 22/22 tests passing (mock scoring, HTTP contract, budget truncation, multi-turn, per-turn de-dup, resume, failure isolation, real agent-loop end-to-end)
> - oxlint clean, full host `tsc -b` typecheck clean
> - End-to-end: first model request carries the injected block (351 chars, 3 hits, ~2ms retrieval = 0 tokens); later rounds re-send it from history (re-billing semantics confirmed)
>
> ### Roadmap
> - M2: wire the real intranet knowledge base (HTTP endpoint per contract v0.2)
> - M3: mount the KB's MCP access surface for on-demand in-loop retrieval

**中文版正文：**

> ### 亮点
> - 首轮模型请求前确定性 0 token 知识库检索并注入
> - 契约 v0.2：`context` 会话上下文传递（知识库侧理解）+ `query` 关键词模式
> - `once`（仅首轮）/ `per-turn`（每轮增量，`doc_id` 去重）两种注入模式
> - 注入状态从会话日志重建（`pre-retrieval-ids` meta section），恢复会话不重复注入
> - 静默降级：检索失败不阻塞任务
> - Mock 检索器（开发/验证）+ HTTP 检索器（契约 v0.2，端点可配置）
> - 默认预算：`topK=3` / `maxChars=4000` / `minScore=0.2` / `contextMaxChars=2000`
>
> ### 验证
> - 22/22 测试通过（mock 计分、HTTP 契约、预算截断、多轮、per-turn 去重、resume、失败隔离、真实 agent loop 端到端）
> - oxlint 0 错误，全仓 host `tsc -b` typecheck 通过
> - 端到端：首轮模型请求携带注入块（351 字符、3 命中、检索约 2ms = 0 token）；后续轮次从历史重发（重复计费语义确认）
>
> ### 路线图
> - M2：接入真实内网知识库（按契约 v0.2 填 HTTP 端点）
> - M3：挂载知识库 MCP 访问面，循环内按需补取
