# dsh-pre-retrieval 详细验证报告（v0.2 升级版）

> 生成时间：2026 年 · 插件 `@deepseek-ai/dsh-pre-retrieval`
> 覆盖：契约 v0.2（上下文传递）+ queryMode(rule/context) + injectMode(once/per-turn) + resume 语义
> 仓库：`deepseek-harness`（packages/context/pre-retrieval/）

---

## 1. 验证环境

| 项 | 值 |
|---|---|
| Node.js | v24.16.0（要求 `^22.19.0 \|\| >=24.0.0` ✓） |
| pnpm | 11.7.0 |
| 测试运行器 | vitest v4.1.8 |
| Linter | oxlint 1.76.0（89 规则） |
| TypeScript | 6.0.3（`tsc -b tsconfig.host.json` 全仓 host 聚合） |

## 2. 测试矩阵（22/22 通过）

### 2.1 MockRetriever

| # | 用例 | 验证点 |
|---|---|---|
| 1 | scores keyword hits and caps at topK, ordered by score | 中文查询命中、降序、topK 上限 |
| 2 | returns the default ranking when the query has no terms | 空查询退回内置相关性排序 |

### 2.2 HttpRetriever（契约 v0.2）

| # | 用例 | 验证点 |
|---|---|---|
| 3 | posts the contract body and normalizes hits | `POST` + `{query, top_k, scope}` body + 响应规范化 |
| 4 | throws RetrieverError on a non-2xx response | HTTP 503 → `RetrieverError` |
| 5 | throws RetrieverError when the response lacks a hits array | 畸形响应 → `RetrieverError` |
| 6 | throws RetrieverError when configured without an endpoint | 配置错误 |

### 2.3 renderInjection

| # | 用例 | 验证点 |
|---|---|---|
| 7 | renders an attributed header with per-source counts | 头部/逐条格式 |
| 8 | truncates to the character budget and marks the result | 截断 + `truncated` 标记 |

### 2.4 注入逻辑

| # | 用例 | 验证点 |
|---|---|---|
| 9 | injects retrieved hits into the first step and marks the session | 首轮注入；source snapshot + **ids meta section**（resume 去重用）；`surfaceOp: append` |
| 10 | injects only once per session across later steps and turns | once 模式会话级一次 |
| 11 | injects nothing when disabled | 总开关 |
| 12 | injects nothing when no hit passes minScore | 低分过滤 |
| 13 | respects the character budget end to end | 硬预算截断 |
| 14 | does not inject on non-first steps | 非 step 1 不注入 |

### 2.5 上下文传递 + 多轮 + resume（v0.2 新增）

| # | 用例 | 验证点 |
|---|---|---|
| 15 | sends conversation context in the HTTP request body (v0.2) | `{context:[...]}` 发送、空 query 省略、`top_k` 正确 |
| 16 | injects once across multiple user turns in once mode | 3 轮用户消息后仍只有 1 条注入 |
| 17 | per-turn mode injects fresh hits on later turns without repeating doc_ids | 第二轮新需求注入新 doc（部署规范），**已注入的 billing 不重复**，ids 全局唯一 |
| 18 | does not re-inject after resume in once mode | 新插件实例 + 同一 session → 不重复注入（状态从会话日志重建） |
| 19 | reconstructs injected doc_ids from the session log after resume (per-turn) | 会话已有注入（ids 记录）→ 恢复后已注入 doc_id 不重复注入 |
| 20 | degrades silently when the HTTP request throws | fetch 抛网络异常 → 不注入、不抛错、打点 |
| 21 | isolates failure state per agent | agent A 检索失败不影响 agent B 注入（失败状态按 agent 隔离） |

### 2.6 真实 agent-loop 端到端

| # | 用例 | 验证点 |
|---|---|---|
| 22 | carries the pre-retrieved context into the model request and injects only once | 完整 loop：首轮请求含「预检索资料」块；第二轮从历史重发（重复计费语义）；注入事件恰 1 条 |

## 3. 端到端演示证据（真实 agent loop，context/once 模式）

演示脚本：`deepseek_research\demo-pre-retrieval.mts`（`cd deepseek-harness && pnpm exec tsx <脚本>`）

**输入任务**：`实现计费模块，参照内网规范`

**首轮模型请求 messages（逐条）**：

```
--- message[0] role=user ---
实现计费模块，参照内网规范

--- message[1] role=user ---
【预检索资料 · docs:2 code:1 · 来源 mock】
docs[1] 《内网模型服务部署规范》 ops/deploy.md
  模型服务统一走 vLLM，必须开启 prefix caching 以复用相同前缀的 KV cache，显著降低重复输入的 prefill 开销。
docs[2] 《计费系统架构》 src/architecture/billing.md
  月度计费入口 BillingService：订单结算 → 账单生成 → 对账，超时重试 3 次。
code[3] 《BillingService》 src/billing/service.ts:42
  class BillingService(apiKey) — 月度计费入口，负责订单结算与账单生成。refs: 17
```

**关键统计**：

| 指标 | 值 | 说明 |
|---|---|---|
| 模型请求数 | 2 | 工具调用驱动两轮 |
| 注入次数 | **1** | once 模式每会话一次 |
| 注入文本长度 | 351 字符 | 3 条命中：docs:2 code:1 |
| 打点日志 | `[pre-retrieval] injected 351 chars, 3 hits, 3ms, truncated=false, mode=context/once` | 检索 3ms = 0 token |
| 第二轮含预检索块 | **true** | 历史重发 = 重复计费语义确认 |

## 4. 覆盖缺口对照（针对上轮评审）

| 场景 | 上轮状态 | 现在 | 验证用例 |
|---|---|---|---|
| 多轮对话（3+ 轮） | ❌ | ✅ | #16 |
| 知识需求中途变化 | ❌ | ✅ per-turn 增量 | #17 |
| 会话恢复（resume） | ❌ | ✅ once 不重注入 / per-turn ids 重建 | #18 #19 |
| 网络异常降级（fetch 抛错） | ❌ | ✅ | #20 |
| 多 agent 隔离 | ❌ | ✅ 失败状态隔离 | #21 |
| 上下文交给知识库（context 传递） | ❌ | ✅ 契约 v0.2 + 插件 context 模式 | #15 + 端到端 |
| compaction 触发后的真实行为 | ❌ | ⚠️ 部分（ids 从日志重建，注入块被摘要后可 per-turn 重补；真实 compaction 引擎联测待 M2 环境） | #19 模拟 |
| 注入消息顺序对模型理解的影响 | ⚠️ | ⚠️ 已知设计（append 到任务消息之后），留待真实模型评测 | — |

## 5. 静态检查

```
oxlint:            Found 0 warnings and 0 errors.
tsc -b tsconfig.host.json:  无错误（exit 0）
```

## 6. v0.2 升级内容

1. **契约 v0.2**：请求体新增 `context`（`KbContextEntry[]`，`role: user|assistant|tool`），`query` 降为可选；响应新增可选 `incremental`（插件不强制依赖，自身按 doc_id 去重）；
2. **queryMode**：`context`（默认，把有界会话上下文交给知识库理解，`contextMaxChars=2000`）/ `rule`（插件提取关键词，向后兼容）；
3. **injectMode**：`once`（默认）/ `per-turn`（每轮增量，只注入未注入过的 doc_id）；
4. **resume 语义**：注入状态（是否已注入、已注入的 doc_id 集合）从会话日志重建（注入消息的 `pre-retrieval-ids` meta section），不依赖进程内存——恢复会话后不重复注入、不重复 doc_id；
5. **失败策略**：once 失败标记会话、per-turn 失败标记本轮（下轮可重试），均静默降级。

## 7. 复现命令

```bash
cd deepseek-harness
pnpm vitest run packages/context/pre-retrieval            # 22 个测试
pnpm vitest run packages/context/pre-retrieval --reporter=verbose   # 逐用例输出
pnpm exec oxlint packages/context/pre-retrieval           # lint
pnpm exec tsc -b tsconfig.host.json                        # 全仓 typecheck
pnpm exec tsx deepseek_research\demo-pre-retrieval.mts  # 端到端演示
```
