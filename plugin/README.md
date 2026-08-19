# @deepseek-ai/dsh-pre-retrieval

知识库前置检索插件：**在模型请求派生前**，用确定性检索（0 token）从内部知识库取回命中，注入上下文，让 agent 在检索结果之上工作——把"探索性检索"从 LLM 循环中移除。

[English](README.en.md) | **中文**

## 为什么省 token

- 检索执行（向量库 / SQL / HTTP）是确定性代码，**0 token**；
- 结果注入上下文后按「长度 × 剩余轮次」重复计费，所以默认预算刻意保守（`topK=3`、`maxChars=4000`、`minScore=0.2`）；
- 探索轮次（猜路径、Read 整文件、反复试搜）是慢模型下最贵的部分，本插件将其替换为预检索。

## 两种查询模式

| 模式 | 行为 | 适用 |
|---|---|---|
| `queryMode: context`（默认） | 把**有界的会话上下文**（本轮消息 + 历史要点，`contextMaxChars=2000`）交给知识库，由知识库理解并检索 | 知识库有能力理解上下文；知识需求随对话演进 |
| `queryMode: rule` | 插件取任务文本前 `queryChars=800` 字符作为 query | 知识库只接受关键词查询 |

## 两种注入模式

| 模式 | 行为 | 适用 |
|---|---|---|
| `injectMode: once`（默认） | 首轮注入一次，之后不再注入 | 任务开始就知道需要什么 |
| `injectMode: per-turn` | 每轮检查，只注入**此前未注入过的 doc_id** | 长会话、知识需求中途变化 |

per-turn 的 doc_id 去重状态**从会话日志重建**（注入消息的 meta section 记录 ids），因此会话恢复（resume）后不重复注入；once 模式同样从会话日志判定，恢复后不重注入。

## 安装

```yaml
# cordis.yml（现有 DSH 实例的组合文件）
- id: pre-retrieval
  name: '@deepseek-ai/dsh-pre-retrieval'
  config:
    enabled: true
    retriever: mock          # 知识库接口提供后切 http
    queryMode: context       # context | rule
    injectMode: once         # once | per-turn
    topK: 3
    maxChars: 4000
    minScore: 0.2
```

`$DSH_HOME/settings.yaml` 可热重载覆盖同名字段，无需重启：

```yaml
pre-retrieval:
  injectMode: per-turn
  contextMaxChars: 4000
```

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `retriever` | `mock` | `mock`（内置样例，开发/验证）或 `http`（真实知识库） |
| `queryMode` | `context` | `context`：把会话上下文交给知识库理解；`rule`：插件提取关键词 query |
| `injectMode` | `once` | `once`：首轮注入一次；`per-turn`：每轮增量注入（doc_id 去重） |
| `topK` | `3` | 每轮最多注入的命中数 |
| `maxChars` | `4000` | 注入文本硬预算（字符），超限截断并标注 |
| `minScore` | `0.2` | 低于该分值的命中直接丢弃 |
| `queryChars` | `800` | rule 模式：取任务文本前 N 字符作为 query |
| `contextMaxChars` | `2000` | context 模式：发送给知识库的上下文总体积（字符） |
| `scope` | `null` | 透传给知识库的检索范围（如仓库/团队过滤） |
| `http.endpoint` | `''` | `POST /search` 完整地址（`retriever: http` 时必填） |
| `http.timeoutMs` | `3000` | 检索超时；失败静默降级（不注入、不阻塞任务） |
| `http.headers` | `{}` | 额外请求头（内网鉴权） |

## 检索接口契约 v0.2（与知识库方对齐）

```http
POST {endpoint}
Content-Type: application/json

// context 模式（query 可省略，知识库理解 context）
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

// rule 模式（发送 query）
{ "query": "实现计费模块，参照内网规范", "top_k": 3 }
```

```jsonc
// 200
{
  "hits": [
    { "doc_id": "…", "title": "…", "path": "…", "snippet": "≤500 字符", "score": 0.87, "source": "docs" }
  ],
  "truncated": false,
  "incremental": false   // 可选：true = 命中已按相对上次检索去重（插件不强制依赖，自身按 doc_id 去重）
}
```

- `hits` 按相关度降序；插件取前 `topK` 后按 `minScore` 过滤，再按 `doc_id` 去重（per-turn 模式）；
- `snippet` 建议 ≤ 500 字符——它进入上下文后每轮重复计费；
- 非 2xx / 超时 / 畸形响应 → 插件打点后**不注入**，任务照常。

## 注入格式

```
【预检索资料 · docs:2 code:1 · 来源 mock】
docs[1] 《计费系统架构》 src/architecture/billing.md
  月度计费入口 BillingService：订单结算 → 账单生成 → 对账，超时重试 3 次。
code[1] BillingService  src/billing/service.ts:42
  class BillingService(apiKey) — 月度计费入口。refs: 17
```

## 行为与不变量

- **每轮至多注入一次**（step 1）；once 模式整个会话至多一次；per-turn 模式每轮增量、doc_id 不重复；
- 注入为 `source.kind: 'plugin'` 的独立 user 消息，带 `form: 'snapshot'` 主 section 与 `pre-retrieval-ids` meta section（记录 doc_id，供 resume 去重）；
- 会话状态（是否已注入、注入过哪些 doc_id）**从会话日志重建**，不依赖进程内存——resume/恢复后保持一致；
- 检索失败：once 模式标记整个会话不再试，per-turn 模式标记本轮不再试（下轮可重试）；都静默降级不阻塞任务；
- 遥测打点：`[pre-retrieval] injected {chars} chars, {hits} hits, {latencyMs}ms, truncated={bool}, mode={queryMode}/{injectMode}`。

## 测试

```bash
pnpm vitest run packages/context/pre-retrieval
```

覆盖（22 用例）：mock 中文关键词/双字重合计分、HTTP 契约 v0.2（context 请求体/规范化/错误/网络异常降级）、渲染预算截断、首轮注入、once 多轮持久性、per-turn 增量与 doc_id 去重、resume（once 不重注入、per-turn ids 重建）、多 agent 失败隔离、真实 agent loop 首轮请求携带注入。

## 后续（M2/M3）

- **M2**：知识库 HTTP 接口提供后 `retriever: http` 并填 `endpoint`（适配层集中在 `HttpRetriever` 一处；契约 v0.2 对齐）；
- **M3**：知识库 MCP 访问面挂 `@deepseek-ai/dsh-mcp-client`，agent 循环内按需补取细节，与预取形成双链路。
