# dsh-pre-retrieval 璇︾粏楠岃瘉鎶ュ憡锛坴0.2 鍗囩骇鐗堬級

> 鐢熸垚鏃堕棿锛?026 骞?路 鎻掍欢 `@deepseek-ai/dsh-pre-retrieval`
> 瑕嗙洊锛氬绾?v0.2锛堜笂涓嬫枃浼犻€掞級+ queryMode(rule/context) + injectMode(once/per-turn) + resume 璇箟
> 浠撳簱锛歚deepseek-harness`锛坧ackages/context/pre-retrieval/锛?
---

## 1. 楠岃瘉鐜

| 椤?| 鍊?|
|---|---|
| Node.js | v24.16.0锛堣姹?`^22.19.0 \|\| >=24.0.0` 鉁擄級 |
| pnpm | 11.7.0 |
| 娴嬭瘯杩愯鍣?| vitest v4.1.8 |
| Linter | oxlint 1.76.0锛?9 瑙勫垯锛?|
| TypeScript | 6.0.3锛坄tsc -b tsconfig.host.json` 鍏ㄤ粨 host 鑱氬悎锛?|

## 2. 娴嬭瘯鐭╅樀锛?2/22 閫氳繃锛?
### 2.1 MockRetriever

| # | 鐢ㄤ緥 | 楠岃瘉鐐?|
|---|---|---|
| 1 | scores keyword hits and caps at topK, ordered by score | 涓枃鏌ヨ鍛戒腑銆侀檷搴忋€乼opK 涓婇檺 |
| 2 | returns the default ranking when the query has no terms | 绌烘煡璇㈤€€鍥炲唴缃浉鍏虫€ф帓搴?|

### 2.2 HttpRetriever锛堝绾?v0.2锛?
| # | 鐢ㄤ緥 | 楠岃瘉鐐?|
|---|---|---|
| 3 | posts the contract body and normalizes hits | `POST` + `{query, top_k, scope}` body + 鍝嶅簲瑙勮寖鍖?|
| 4 | throws RetrieverError on a non-2xx response | HTTP 503 鈫?`RetrieverError` |
| 5 | throws RetrieverError when the response lacks a hits array | 鐣稿舰鍝嶅簲 鈫?`RetrieverError` |
| 6 | throws RetrieverError when configured without an endpoint | 閰嶇疆閿欒 |

### 2.3 renderInjection

| # | 鐢ㄤ緥 | 楠岃瘉鐐?|
|---|---|---|
| 7 | renders an attributed header with per-source counts | 澶撮儴/閫愭潯鏍煎紡 |
| 8 | truncates to the character budget and marks the result | 鎴柇 + `truncated` 鏍囪 |

### 2.4 娉ㄥ叆閫昏緫

| # | 鐢ㄤ緥 | 楠岃瘉鐐?|
|---|---|---|
| 9 | injects retrieved hits into the first step and marks the session | 棣栬疆娉ㄥ叆锛泂ource snapshot + **ids meta section**锛坮esume 鍘婚噸鐢級锛沗surfaceOp: append` |
| 10 | injects only once per session across later steps and turns | once 妯″紡浼氳瘽绾т竴娆?|
| 11 | injects nothing when disabled | 鎬诲紑鍏?|
| 12 | injects nothing when no hit passes minScore | 浣庡垎杩囨护 |
| 13 | respects the character budget end to end | 纭绠楁埅鏂?|
| 14 | does not inject on non-first steps | 闈?step 1 涓嶆敞鍏?|

### 2.5 涓婁笅鏂囦紶閫?+ 澶氳疆 + resume锛坴0.2 鏂板锛?
| # | 鐢ㄤ緥 | 楠岃瘉鐐?|
|---|---|---|
| 15 | sends conversation context in the HTTP request body (v0.2) | `{context:[...]}` 鍙戦€併€佺┖ query 鐪佺暐銆乣top_k` 姝ｇ‘ |
| 16 | injects once across multiple user turns in once mode | 3 杞敤鎴锋秷鎭悗浠嶅彧鏈?1 鏉℃敞鍏?|
| 17 | per-turn mode injects fresh hits on later turns without repeating doc_ids | 绗簩杞柊闇€姹傛敞鍏ユ柊 doc锛堥儴缃茶鑼冿級锛?*宸叉敞鍏ョ殑 billing 涓嶉噸澶?*锛宨ds 鍏ㄥ眬鍞竴 |
| 18 | does not re-inject after resume in once mode | 鏂版彃浠跺疄渚?+ 鍚屼竴 session 鈫?涓嶉噸澶嶆敞鍏ワ紙鐘舵€佷粠浼氳瘽鏃ュ織閲嶅缓锛?|
| 19 | reconstructs injected doc_ids from the session log after resume (per-turn) | 浼氳瘽宸叉湁娉ㄥ叆锛坕ds 璁板綍锛夆啋 鎭㈠鍚庡凡娉ㄥ叆 doc_id 涓嶉噸澶嶆敞鍏?|
| 20 | degrades silently when the HTTP request throws | fetch 鎶涚綉缁滃紓甯?鈫?涓嶆敞鍏ャ€佷笉鎶涢敊銆佹墦鐐?|
| 21 | isolates failure state per agent | agent A 妫€绱㈠け璐ヤ笉褰卞搷 agent B 娉ㄥ叆锛堝け璐ョ姸鎬佹寜 agent 闅旂锛?|

### 2.6 鐪熷疄 agent-loop 绔埌绔?
| # | 鐢ㄤ緥 | 楠岃瘉鐐?|
|---|---|---|
| 22 | carries the pre-retrieved context into the model request and injects only once | 瀹屾暣 loop锛氶杞姹傚惈銆岄妫€绱㈣祫鏂欍€嶅潡锛涚浜岃疆浠庡巻鍙查噸鍙戯紙閲嶅璁¤垂璇箟锛夛紱娉ㄥ叆浜嬩欢鎭?1 鏉?|

## 3. 绔埌绔紨绀鸿瘉鎹紙鐪熷疄 agent loop锛宑ontext/once 妯″紡锛?
婕旂ず鑴氭湰锛歚deepseek_research\demo-pre-retrieval.mts`锛坄cd deepseek-harness && pnpm exec tsx <鑴氭湰>`锛?
**杈撳叆浠诲姟**锛歚瀹炵幇璁¤垂妯″潡锛屽弬鐓у唴缃戣鑼僠

**棣栬疆妯″瀷璇锋眰 messages锛堥€愭潯锛?*锛?
```
--- message[0] role=user ---
瀹炵幇璁¤垂妯″潡锛屽弬鐓у唴缃戣鑼?
--- message[1] role=user ---
銆愰妫€绱㈣祫鏂?路 docs:2 code:1 路 鏉ユ簮 mock銆?docs[1] 銆婂唴缃戞ā鍨嬫湇鍔￠儴缃茶鑼冦€?ops/deploy.md
  妯″瀷鏈嶅姟缁熶竴璧?vLLM锛屽繀椤诲紑鍚?prefix caching 浠ュ鐢ㄧ浉鍚屽墠缂€鐨?KV cache锛屾樉钁楅檷浣庨噸澶嶈緭鍏ョ殑 prefill 寮€閿€銆?docs[2] 銆婅璐圭郴缁熸灦鏋勩€?src/architecture/billing.md
  鏈堝害璁¤垂鍏ュ彛 BillingService锛氳鍗曠粨绠?鈫?璐﹀崟鐢熸垚 鈫?瀵硅处锛岃秴鏃堕噸璇?3 娆°€?code[3] 銆夿illingService銆?src/billing/service.ts:42
  class BillingService(apiKey) 鈥?鏈堝害璁¤垂鍏ュ彛锛岃礋璐ｈ鍗曠粨绠椾笌璐﹀崟鐢熸垚銆俽efs: 17
```

**鍏抽敭缁熻**锛?
| 鎸囨爣 | 鍊?| 璇存槑 |
|---|---|---|
| 妯″瀷璇锋眰鏁?| 2 | 宸ュ叿璋冪敤椹卞姩涓よ疆 |
| 娉ㄥ叆娆℃暟 | **1** | once 妯″紡姣忎細璇濅竴娆?|
| 娉ㄥ叆鏂囨湰闀垮害 | 351 瀛楃 | 3 鏉″懡涓細docs:2 code:1 |
| 鎵撶偣鏃ュ織 | `[pre-retrieval] injected 351 chars, 3 hits, 3ms, truncated=false, mode=context/once` | 妫€绱?3ms = 0 token |
| 绗簩杞惈棰勬绱㈠潡 | **true** | 鍘嗗彶閲嶅彂 = 閲嶅璁¤垂璇箟纭 |

## 4. 瑕嗙洊缂哄彛瀵圭収锛堥拡瀵逛笂杞瘎瀹★級

| 鍦烘櫙 | 涓婅疆鐘舵€?| 鐜板湪 | 楠岃瘉鐢ㄤ緥 |
|---|---|---|---|
| 澶氳疆瀵硅瘽锛?+ 杞級 | 鉂?| 鉁?| #16 |
| 鐭ヨ瘑闇€姹備腑閫斿彉鍖?| 鉂?| 鉁?per-turn 澧為噺 | #17 |
| 浼氳瘽鎭㈠锛坮esume锛?| 鉂?| 鉁?once 涓嶉噸娉ㄥ叆 / per-turn ids 閲嶅缓 | #18 #19 |
| 缃戠粶寮傚父闄嶇骇锛坒etch 鎶涢敊锛?| 鉂?| 鉁?| #20 |
| 澶?agent 闅旂 | 鉂?| 鉁?澶辫触鐘舵€侀殧绂?| #21 |
| 涓婁笅鏂囦氦缁欑煡璇嗗簱锛坈ontext 浼犻€掞級 | 鉂?| 鉁?濂戠害 v0.2 + 鎻掍欢 context 妯″紡 | #15 + 绔埌绔?|
| compaction 瑙﹀彂鍚庣殑鐪熷疄琛屼负 | 鉂?| 鈿狅笍 閮ㄥ垎锛坕ds 浠庢棩蹇楅噸寤猴紝娉ㄥ叆鍧楄鎽樿鍚庡彲 per-turn 閲嶈ˉ锛涚湡瀹?compaction 寮曟搸鑱旀祴寰?M2 鐜锛?| #19 妯℃嫙 |
| 娉ㄥ叆娑堟伅椤哄簭瀵规ā鍨嬬悊瑙ｇ殑褰卞搷 | 鈿狅笍 | 鈿狅笍 宸茬煡璁捐锛坅ppend 鍒颁换鍔℃秷鎭箣鍚庯級锛岀暀寰呯湡瀹炴ā鍨嬭瘎娴?| 鈥?|

## 5. 闈欐€佹鏌?
```
oxlint:            Found 0 warnings and 0 errors.
tsc -b tsconfig.host.json:  鏃犻敊璇紙exit 0锛?```

## 6. v0.2 鍗囩骇鍐呭

1. **濂戠害 v0.2**锛氳姹備綋鏂板 `context`锛坄KbContextEntry[]`锛宍role: user|assistant|tool`锛夛紝`query` 闄嶄负鍙€夛紱鍝嶅簲鏂板鍙€?`incremental`锛堟彃浠朵笉寮哄埗渚濊禆锛岃嚜韬寜 doc_id 鍘婚噸锛夛紱
2. **queryMode**锛歚context`锛堥粯璁わ紝鎶婃湁鐣屼細璇濅笂涓嬫枃浜ょ粰鐭ヨ瘑搴撶悊瑙ｏ紝`contextMaxChars=2000`锛? `rule`锛堟彃浠舵彁鍙栧叧閿瘝锛屽悜鍚庡吋瀹癸級锛?3. **injectMode**锛歚once`锛堥粯璁わ級/ `per-turn`锛堟瘡杞閲忥紝鍙敞鍏ユ湭娉ㄥ叆杩囩殑 doc_id锛夛紱
4. **resume 璇箟**锛氭敞鍏ョ姸鎬侊紙鏄惁宸叉敞鍏ャ€佸凡娉ㄥ叆鐨?doc_id 闆嗗悎锛変粠浼氳瘽鏃ュ織閲嶅缓锛堟敞鍏ユ秷鎭殑 `pre-retrieval-ids` meta section锛夛紝涓嶄緷璧栬繘绋嬪唴瀛樷€斺€旀仮澶嶄細璇濆悗涓嶉噸澶嶆敞鍏ャ€佷笉閲嶅 doc_id锛?5. **澶辫触绛栫暐**锛歰nce 澶辫触鏍囪浼氳瘽銆乸er-turn 澶辫触鏍囪鏈疆锛堜笅杞彲閲嶈瘯锛夛紝鍧囬潤榛橀檷绾с€?
## 7. 澶嶇幇鍛戒护

```bash
cd deepseek-harness
pnpm vitest run packages/context/pre-retrieval            # 22 涓祴璇?pnpm vitest run packages/context/pre-retrieval --reporter=verbose   # 閫愮敤渚嬭緭鍑?pnpm exec oxlint packages/context/pre-retrieval           # lint
pnpm exec tsc -b tsconfig.host.json                        # 鍏ㄤ粨 typecheck
pnpm exec tsx deepseek_research\demo-pre-retrieval.mts  # 绔埌绔紨绀?```
