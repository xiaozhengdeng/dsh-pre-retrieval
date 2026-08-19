# DSH 知识库前置检索方案（Pre-Retrieval for DSH）

> 状态：待审核（v0.2，根据审核反馈修订）
> 目标环境：公司内网，自部署慢模型，token 昂贵
> 已确认约束：**知识库已存在**（对外暴露 MCP 访问面；HTTP 接口后续提供）；运行在**现有 DSH 实例**；我们不建索引、不建知识库，只做「预检索适配 + 注入」这一层，**检索接口按契约预留**。

---

## 1. 背景与目标

内网连不到外部大模型，自部署模型慢且 token 资源有限。已确认的省钱逻辑：

- 检索执行本身 **0 token**（确定性代码）；
- **结果一进上下文就开始计费、且每轮重复计费**；
- 省钱 = 让进上下文的信息**尽量少、尽量短、用完尽快清**，并**消灭"找的过程"**（agent 猜路径、Read 大文件、反复试搜等探索性 LLM 轮次）。

本方案在 DSH 上落地第一块：**循环前预检索**。DSH 插件在首轮请求派生前调用知识库（HTTP 接口，契约预留），把 Top-N 结果一次性注入初始上下文，agent 只在注入结果之上工作。终极形态为三件套：**预取（本方案）+ 循环内 MCP 按需（知识库已提供 MCP 访问面，M3 接入）+ 历史外置（M3）**。

## 2. 已验证的 DSH 事实（基于 deepseek-harness 源码）

| 机制 | 位置 | 说明 |
|---|---|---|
| 插件骨架 | `packages/context/time-context/src/index.ts` | Cordis 插件 = `name` + `inject` + `Config`(schemastery) + `apply(ctx, config)`，`cordis.yml` 注册 |
| 注入机制 A | `docs/subsystems/system-prompt.md` | `ctx.systemPrompt.context()`：`PromptContext`（text provider，按 order 拼接），装配为 durable user-role 快照，仅在变化时记录 |
| 注入机制 B | `time-context` 源码 | 监听 `agent/pre-step`，`createUserMessage({source:{kind:'plugin'}})` 把内容作为 user 消息进入本轮请求，**完全控制时机**（可只在首轮 step 1 注入一次） |
| 自动压缩 | `@deepseek-ai/dsh-compaction-basic` | `thresholdRatio`(0.8) / `retainRatio`(0.16) / `retainTokens` / `modelPolicies`；压缩摘要调用重放前缀以复用 KV 缓存 |
| 工具结果剪枝 | `@deepseek-ai/dsh-compaction-tool-result-pruner` | 大工具输出裁剪（默认前 4096 / 后 1024 字符） |
| MCP 客户端 | `@deepseek-ai/dsh-mcp-client` | stdio / streamable-http，工具注册为 `mcp__<server>__<tool>`（M3 挂知识库 MCP 用） |
| 内网 LLM | `@deepseek-ai/dsh-llm-deepseek`（`baseURL` 指内网端点）、`@deepseek-ai/dsh-llm-pi-ai` | 均支持 apiKeyEnv |
| token 计量 | `@deepseek-ai/dsh-token-meter` | 会话级压力计量，压缩事件记录被遮蔽 token 数 |
| 配置覆盖 | `@deepseek-ai/dsh-settings-file` | `$DSH_HOME/settings.yaml` 热重载覆盖插件配置 |

## 3. 总体架构

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│  内网知识库（已有，不在本方案内） │        │         DSH 现有实例             │
│                              │        │  ┌────────────────────────┐  │
│  · 文档/代码索引               │ HTTP    │  │ dsh-pre-retrieval 插件 │  │
│  · 语义检索 + rerank           │◄──────►│  │  · 首轮 pre-step 触发   │  │
│  · MCP 访问面（M3 接入）        │ 契约预留 │  │  · 查询提取(0 LLM)      │  │
└──────────────────────────────┘        │  · 预算/截断/降级          │  │
                                        │  · 一次性注入初始上下文     │  │
                                        └───────────┬────────────┘  │
                                                    ▼               │
                                        ┌───────────────────────┐   │
                                        │ 内网 LLM(慢模型)        │   │
                                        │ 只在注入结果之上推理      │   │
                                        └───────────────────────┘   │
                                        └──────────────────────────────┘
```

- **预取链路（本方案核心）**：插件首轮调知识库 HTTP 接口 → Top-N 注入初始上下文 → agent 开始工作；
- **按需链路（M3）**：知识库 MCP 挂到 `dsh-mcp-client`，agent 循环内可再查细节。

## 4. 组件设计

### 4.1 核心交付：插件 `@deepseek-ai/dsh-pre-retrieval`

**职责**（单一：任务开始时做一次预检索并注入）：

1. **触发时机**：`agent/pre-step` 且 `step === 1`（首轮请求派生前），每会话默认只注入一次；
2. **查询提取**（0 LLM）：拼接本轮 user 消息前 N 字符（默认 800）作为检索 query，可按 `scope` 限定来源；
3. **调用知识库**：经 `Retriever` 接口（见 4.2），默认 `HttpRetriever`，超时/失败**静默降级**（不注入、不阻塞任务、打点记录）；
4. **预算控制**：默认 `topK=3`、`maxChars=4000`（约 1-2K token）；超限截断并附 `truncated` 标记；`minScore` 以下丢弃——**宁可少注入，不注入噪声**；
5. **注入**：默认机制 B（首轮 user 消息，可控、可压缩、可溯源）；可选机制 A（PromptContext，需内部缓存保证幂等）；
6. **缓存**：按 `(query hash, topK, sources)` 会话内缓存，避免中途重入重复检索；
7. **打点**：每次注入记录 `{chars, hits, source, latencyMs, error?}` 到会话日志，供收益量化与知识库侧排查。

注入格式（紧凑、可溯源）：

```
【预检索资料 · docs:2 · 来源 kb v2026-xx · 接口契约 v0.1】
docs[1] 《计费系统架构》 src/architecture/billing.md#计费主流程
  月度计费入口 BillingService，订单结算→账单生成→对账，超时重试 3 次……
docs[2] 《内网部署规范》 ops/deploy.md#模型服务
  模型服务统一走 vLLM，必须开启 prefix caching……
```

### 4.2 检索接口抽象（契约预留，知识库侧对齐用）

插件只依赖 `Retriever` 接口，两个实现：

- **`MockRetriever`**（默认，M1 开发/验证用）：内置样例命中，不依赖知识库，端到端验证注入链路；
- **`HttpRetriever`**（对接真实知识库）：按下面契约实现；知识库真实接口提供后，只改配置不改插件。

**接口契约 v0.1**（HTTP，待与知识库方确认）：

```http
POST /search
Content-Type: application/json

{
  "query": "字符串：检索查询",
  "top_k": 3,                     // 期望命中数
  "sources": ["docs", "code"],    // 可选：限定来源
  "scope": { "repo": "billing" }  // 可选：上下文限定（仓库/团队）
}
```

```jsonc
// 200 响应
{
  "hits": [
    {
      "doc_id": "billing-arch-001",
      "title": "计费系统架构",
      "path": "src/architecture/billing.md",
      "snippet": "……高相关片段（≤ 500 字符）……",
      "score": 0.87,
      "source": "docs"
    }
  ],
  "truncated": false
}
```

契约要点（对齐时确认）：
- 响应中 `snippet` 必须**短**（建议 ≤ 500 字符），长内容由 M3 的按需工具取全文；
- 非 2xx / 超时（默认 3s）/ 网络错误 → 插件降级不注入，任务照常；
- `hits` 需按相关度降序，插件取前 `topK` 后按 `minScore` 过滤；
- 预留 `sources` / `scope` 字段以便按仓库/团队限定检索范围。

### 4.3 循环内按需检索（M3，利用已有 MCP 访问面）

知识库已暴露 MCP 访问面 → 直接用 `dsh-mcp-client` 挂载，无需自建：

```yaml
- id: mcp-kb
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: kb
    transport: streamable-http     # 或 stdio，视知识库 MCP 形态
    url: <知识库 MCP 端点，待提供>
```

工具注册为 `mcp__kb__search` 等，agent 循环内按需取细节；配合预取形成「启动预取 + 按需补取」双链路。

## 5. 配置示例

```yaml
# cordis.yml
- id: pre-retrieval
  name: '@deepseek-ai/dsh-pre-retrieval'
  config:
    enabled: true
    retriever: mock               # mock | http（真实接口提供后切换）
    topK: 3
    maxChars: 4000
    minScore: 0.2
    injectMode: first-message     # first-message | prompt-context
    queryChars: 800
    scope: null
    http:                          # retriever=http 时
      endpoint: http://kb.internal/search   # 待知识库方提供
      timeoutMs: 3000
      headers: {}                  # 内网鉴权 header 待定
```

`$DSH_HOME/settings.yaml` 可覆盖 `pre-retrieval:` 段（热重载，无需重启）。

## 6. 里程碑

| 阶段 | 内容 | 交付物 | 验收 |
|---|---|---|---|
| **M1（本期）** | 插件 + Retriever 抽象 + Mock 检索器 + 现有 DSH 实例接入；接口契约 v0.1 定稿 | 插件代码、契约文档、mock 配置、端到端演示（mock 命中注入首轮） | 任务首轮携带 ≤4KB 预检索资料；开关关闭后行为不变 |
| **M2** | 知识库 HTTP 接口提供后：填配置切换 `HttpRetriever`；契约对齐（字段、鉴权、超时） | HttpRetriever + 契约核对记录 | 真实知识库命中注入；失败静默降级 |
| **M3** | 循环内 MCP 按需（挂知识库 MCP）+ 历史外置 | dsh-mcp-client 配置 + 外部记忆 | 长会话历史不膨胀 |

M1 完成即具备可验证的注入链路，收益量化后可随时切真实接口。

## 7. 验证与收益量化

- 对照组：同一任务分别跑 开/关 插件；
- 指标：总输入 token（`dsh-token-meter` / 会话日志）、轮次数、端到端耗时、注入 token 占比、检索失败率；
- 目标：M1 验证链路与打点；M2 接真实知识库后每任务总输入 token 降 30-50%（探索轮次大头），M3 叠加 50-70%。

## 8. 决策记录与开放项

已确认：
- D1 知识源：知识库已存在（MCP 访问面），不建索引 ✅
- D2 检索方式：HTTP 调用知识库，接口预留 ✅
- D6 运行形态：现有 DSH 实例/本机 ✅

开放项：
- **D5 M3 是否本期**：默认 M1 验收后再议（M3 只是挂 MCP，工作量小，届时可快速补上）；
- 知识库 HTTP 接口的**实际端点/鉴权/字段**（提供后进 M2）；
- 知识库 MCP 的**工具清单**（提供后进 M3）。

## 9. 风险

| 风险 | 缓解 |
|---|---|
| 预取噪声污染上下文（最贵风险） | minScore + 只取 Top-3 + 注入预算硬上限；snippet 短 |
| 知识库接口未提供，阻塞开发 | M1 用 MockRetriever 先行验证注入链路；契约先行，接口到了只填配置 |
| 知识库慢/不可用 | 3s 超时 + 静默降级不注入 + 打点暴露失败率，不阻塞任务 |
| 契约与真实接口不一致 | 契约 v0.1 文档化，M2 逐字段核对，适配层集中在 HttpRetriever 一处 |
| 注入信息被 compaction 摘要掉 | 注入为独立 user 消息，压缩保留尾部策略可调；细节走 M3 按需工具再取 |
