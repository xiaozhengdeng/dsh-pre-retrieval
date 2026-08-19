# dsh-pre-retrieval 浜や粯鐗?
鐭ヨ瘑搴撳墠缃绱㈡彃浠讹紙DeepSeek Harness锛夛細棣栬疆/姣忚疆妯″瀷璇锋眰鍓嶇敤纭畾鎬ф绱紙0 token锛変粠鍐呴儴鐭ヨ瘑搴撳彇鍥炲懡涓苟娉ㄥ叆涓婁笅鏂囷紝鎶?鎺㈢储鎬ф绱?浠?LLM 寰幆涓Щ闄ゃ€?
> English: [README.en.md](README.en.md)

## 鐩綍缁撴瀯

```
dsh-pre-retrieval/
鈹溾攢鈹€ README.md              # 鏈储寮?鈹溾攢鈹€ plugin/                # 鎻掍欢鍖呮簮鐮侊紙瀵瑰簲 DSH 浠撳簱 packages/context/pre-retrieval锛?鈹?  鈹溾攢鈹€ src/               #   婧愮爜锛歩ndex(娉ㄥ叆閫昏緫) / retriever(Mock+Http) / types(濂戠害v0.2) / render / invariant
鈹?  鈹溾攢鈹€ tests/             #   22 涓祴璇曠敤渚?鈹?  鈹溾攢鈹€ package.json       #   @deepseek-ai/dsh-pre-retrieval
鈹?  鈹溾攢鈹€ tsconfig.json
鈹?  鈹斺攢鈹€ README.md          #   鎻掍欢浣跨敤鏂囨。锛堥厤缃?濂戠害/琛屼负锛?鈹溾攢鈹€ docs/
鈹?  鈹溾攢鈹€ design-plan.md     # 璁捐鏂规锛坴0.2锛氫笂涓嬫枃浼犻€?+ 澧為噺娉ㄥ叆锛?鈹?  鈹斺攢鈹€ verification-report.md  # 璇︾粏楠岃瘉鎶ュ憡锛?2/22 娴嬭瘯 + 绔埌绔瘉鎹級
鈹斺攢鈹€ demo/
    鈹斺攢鈹€ demo-pre-retrieval.mts  # 绔埌绔紨绀鸿剼鏈紙鐪熷疄 agent loop锛?```

## 蹇€熼獙璇侊紙闇€鍦?DSH 浠撳簱鐜鍐呰繍琛岋級

鎻掍欢鏄?DSH monorepo 鐨勪竴閮ㄥ垎锛堜緷璧?`@deepseek-ai/cordis`銆乣dsh-agent` 绛?workspace 鍖呬笌 tsconfig paths 瑙ｆ瀽锛夛紝**涓嶈兘鑴辩 DSH 浠撳簱鐙珛杩愯**銆傞泦鎴愭柟寮忥細鎶?`plugin/` 鏀惧洖 DSH 浠撳簱 `packages/context/pre-retrieval/`锛岀劧鍚庡湪缁勫悎鏂囦欢锛坈ordis.yml锛夋敞鍐岋細

```yaml
- id: pre-retrieval
  name: '@deepseek-ai/dsh-pre-retrieval'
  config:
    retriever: mock          # 鐭ヨ瘑搴撴帴鍙ｆ彁渚涘悗鍒?http + 濉?endpoint
    queryMode: context       # context | rule
    injectMode: once         # once | per-turn
```

楠岃瘉鍛戒护锛堝湪 `deepseek-harness` 涓嬫墽琛岋級锛?
```bash
pnpm vitest run packages/context/pre-retrieval
pnpm exec oxlint packages/context/pre-retrieval
pnpm exec tsc -b tsconfig.host.json
pnpm exec tsx <本仓库路径>\demo\demo-pre-retrieval.mts
```

## 鍏抽敭璁捐鍐崇瓥

| 鍐崇瓥 | 璇存槑 |
|---|---|
| 妫€绱?0 token | 妫€绱㈡槸纭畾鎬т唬鐮侊紱缁撴灉鍏ヤ笂涓嬫枃鍚庢墠璁¤垂锛屾寜銆岄暱搴?脳 鍓╀綑杞銆嶉噸澶嶈璐?|
| 濂戠害 v0.2 | `POST /search` 鏀寔 `context`锛堜細璇濅笂涓嬫枃浜ょ粰鐭ヨ瘑搴撶悊瑙ｏ級+ 鍙€?`query`锛坮ule 妯″紡锛?|
| queryMode | `context`锛堥粯璁わ級锛氭妸鏈夌晫涓婁笅鏂囦氦缁欑煡璇嗗簱锛沗rule`锛氭彃浠舵彁鍙栧叧閿瘝 |
| injectMode | `once`锛堥粯璁わ級棣栬疆涓€娆★紱`per-turn` 姣忚疆澧為噺銆乨oc_id 鍘婚噸 |
| resume 璇箟 | 娉ㄥ叆鐘舵€佷粠浼氳瘽鏃ュ織閲嶅缓锛坄pre-retrieval-ids` meta section锛夛紝鎭㈠涓嶉噸澶嶆敞鍏?|
| 闈欓粯闄嶇骇 | 妫€绱㈠け璐ヤ笉娉ㄥ叆銆佷笉闃诲浠诲姟锛沷nce 澶辫触鏍囪浼氳瘽銆乸er-turn 澶辫触鏍囪鏈疆 |
| 棰勭畻 | `topK=3` / `maxChars=4000` / `minScore=0.2` / `contextMaxChars=2000` 榛樿淇濆畧 |

## 鍚庣画

- **M2**锛氱煡璇嗗簱 HTTP 鎺ュ彛鎻愪緵鍚?`retriever: http`锛堥€傞厤灞傞泦涓湪 `HttpRetriever`锛屽绾?v0.2 瀵归綈锛岃 `docs/design-plan.md` 搂4.2锛夛紱
- **M3**锛氱煡璇嗗簱 MCP 璁块棶闈㈡寕 `@deepseek-ai/dsh-mcp-client`锛屽惊鐜唴鎸夐渶琛ュ彇锛屼笌棰勫彇褰㈡垚鍙岄摼璺€?