# dsh-pre-retrieval 交付物

[English](README.md) | **中文**

知识库前置检索插件（[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)）：首轮/每轮模型请求前用确定性检索（0 token）从内部知识库取回命中并注入上下文，把"探索性检索"从 LLM 循环中移除。

## 目录结构

```
dsh-pre-retrieval/
|-- README.md               # 本索引（英文版）
|-- README.zh.md            # 本索引（中文版）
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

## 快速验证（需在 DSH 仓库环境内运行）

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

## 关键设计决策

| 决策 | 说明 |
|---|---|
| 检索 0 token | 检索是确定性代码；结果入上下文后才计费，按「长度 × 剩余轮次」重复计费 |
| 契约 v0.2 | `POST /search` 支持 `context`（会话上下文交给知识库理解）+ 可选 `query`（rule 模式） |
| queryMode | `context`（默认）：把有界上下文交给知识库；`rule`：插件提取关键词 |
| injectMode | `once`（默认）首轮一次；`per-turn` 每轮增量、doc_id 去重 |
| resume 语义 | 注入状态从会话日志重建（`pre-retrieval-ids` meta section），恢复不重复注入 |
| 静默降级 | 检索失败不注入、不阻塞任务；once 失败标记会话、per-turn 失败标记本轮 |
| 预算 | `topK=3` / `maxChars=4000` / `minScore=0.2` / `contextMaxChars=2000` 默认保守 |

## 后续

- **M2**：知识库 HTTP 接口提供后 `retriever: http`（适配层集中在 `HttpRetriever`，契约 v0.2 对齐，见 `docs/design-plan.md` §4.2）；
- **M3**：知识库 MCP 访问面挂 `@deepseek-ai/dsh-mcp-client`，循环内按需补取，与预取形成双链路。
