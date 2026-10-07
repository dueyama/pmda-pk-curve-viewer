# 依存セキュリティの確認と互換更新

初回監査は2026-10-07 15:24 UTC時点。その後、ユーザーの互換修正・公開承認に沿って依存を更新した。画面確認待ちでpush・配備は保留。秘密設定変更、悪用テスト、侵害検査、外部スキャナーへのソース送信は行っていない。

## 先の更新と実際の版

更新前のローカルHEADと `git ls-remote origin HEAD` はともに `7ea9fc67b72ebe2169f4b5a9bb3523eaefda5701`、コミットは `fix: update Next.js to 16.3.8 security release`。初回監査時のpackage-lock.jsonはこのHEADと一致。全408 lockエントリを確認し、インストール済みパッケージに版の不一致はなかった（未インストールの任意OS用依存は除外）。

実解決版はNext.js/eslint-config-next 16.3.8、React/React DOM 19.2.7、fast-xml-parser 5.8.0、fflate 0.8.3、PostCSS 8.5.28、@vercel/analytics 2.0.1、ESLint 9.39.4、TypeScript 5.9.3。package.jsonの範囲指定だけで判断していない。

親タスクのVercel正規読取結果（この窓口からは再取得していない）: `dpl_C99kjJmsQ2g9s6i2aKqseGBkWZYS`、production READY、上記SHA、[公開alias](https://pmda-pk-curve-viewer.vercel.app)一致、build logにNext.js 16.3.8。Node設定24.x、実際のpatch版は未取得。本番のインストール実体・関数traceをこの窓口が直接確認したとは扱わない。

[Next.js 16.3.8の公式リリース](https://github.com/vercel/next.js/releases/tag/v16.3.8)は9/30の7件（High 1、Medium 5、Low 1）を修正。[9/22の公式ImageResponse告知](https://nextjs.org/blog/nextjs-security-update-september-22-2026)のCritical RCE影響範囲 `>=16.2.0 <16.3.6` に16.3.8は入らない。[React 19.2.7の公式リリース](https://github.com/react/react/releases/tag/v19.2.7)も読取確認した。現npm監査にはNext.js、React、React DOM、fast-xml-parser、fflate、PostCSS、@vercel/analytics本体の指摘はないが、これだけで全体の安全や非侵害を保証しない。

## 更新前の監査で見つかった指摘

`npm audit --json` はHigh 9パッケージ・Critical 0。`npm audit --omit=dev --json` はHigh 1パッケージ・Critical 0。独立した9件のCVEという意味ではなく、原因5パッケージとその依存伝播4パッケージを数えている。

|原因パッケージ（実解決版）|分類|影響条件|修正版・根拠|
|---|---|---|---|
|source-map-js 1.2.1|production依存、High|未信頼のindexed source-mapの巨大なsection offsetを処理するとevent-loop DoS|1.2.2。[GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q)、[上流修正リリース](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)。npmのCVSS 3.1は7.5、現GHSAのCVSS 4は8.7。|
|brace-expansion 1.1.15 / 5.0.6|dev、監査集約High|未信頼のbrace展開パターンでCPU・メモリ・stack DoS|1.1.21 / 5.0.12で監査対象の全範囲を外れる。[最新CPU指摘](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr)自体はModerate、他のHigh指摘も残る。|
|braces 3.0.3|dev、High|深くネストしたbraceパターンの処理でstack枯渇|現告知の修正版はNone。[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)。|
|browserslist 4.28.2|dev/build、High|大量の異なるqueryの永続cacheによるOOM、または未信頼custom statsの正規化でcrash/prototype write|4.28.7。[cache指摘](https://github.com/advisories/GHSA-c83g-rgw3-j3cx)、[custom stats指摘](https://github.com/advisories/GHSA-73wf-gq98-2v4g)。|
|js-yaml 4.2.0|dev、High|未信頼YAMLのmerge-key chains、!!omap、空merge元によるCPU DoS|4.3.2。[merge chains](https://github.com/advisories/GHSA-52cp-r559-cp3m)、[omap](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj)、[空merge元](https://github.com/advisories/GHSA-2883-xcg3-v3hh)。|

brace-expansionの他の指摘は [GHSA-3jxr-9vmj-r5cp](https://github.com/advisories/GHSA-3jxr-9vmj-r5cp)、[GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg)、[GHSA-rgw5-rvv9-x895](https://github.com/advisories/GHSA-rgw5-rvv9-x895)、[GHSA-qhr7-859c-m2p7](https://github.com/advisories/GHSA-qhr7-859c-m2p7)、[GHSA-6j4f-fj2g-mc7p](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p)。

伝播4パッケージは `micromatch 4.0.8 → fast-glob 3.3.1 → @next/eslint-plugin-next 16.3.8 → eslint-config-next 16.3.8`（いずれもlockのdev=true）。bracesの問題を継承している。npmのfixAvailableが提案するeslint-config-next 14.2.35へのmajor降格は、そのまま適切な修正とは扱わない。

## production分類と実行時到達条件

source-map-jsは `next → postcss → source-map-js` なのでprodインストールに含まれる。一方、ローカル完成ビルドの `/api/parse-pmda/route.js.nft.json` にはsource-map-jsもpostcssも含まれていない。アプリソースはPMDA XMLのURLを受け取り、source-mapを入力として処理するコードはない。今回確認した構成では、公開APIから上記の未信頼source-map処理へ到達する証拠はない。これは悪用不可能の証明ではなく、本番関数trace実体も未取得。

残るdev/build依存へのPMDA XML入力経路も確認されない。開発時に未信頼のglob・YAML・browser stats等を取り込む場合は別条件となる。Node.js本番patch、Vercel基盤、独自APIの包括的な安全性、侵害の有無は今回の依存監査では未確認。先のNext.js更新反映と、今回残る依存指摘は分けて扱う。

生の監査結果は `/tmp/drag-audit-all.json` と `/tmp/drag-audit-production.json`、実依存一覧は `/tmp/drag-installed-dependencies.json` にある。ローカル一時確認用で、ソース・秘密・PMDA本文は含まない。この報告は更新や配備の承認を求めるものではない。

## 承認後の更新と再検証

`npm update --ignore-scripts source-map-js brace-expansion browserslist js-yaml` で現在の許容範囲内の版へ更新。package.jsonの依存範囲を拡大せず、Next.js/eslint-config-next 16.3.8、React/React DOM 19.2.7、fast-xml-parser 5.8.0、fflate 0.8.3、PostCSS 8.5.28を維持。force更新やmajor降格は行わない。

|パッケージ|更新前|更新後|
|---|---|---|
|source-map-js|1.2.1|1.2.2|
|brace-expansion（ESLint経由）|1.1.15|1.1.21|
|brace-expansion（TypeScript ESLint経由）|5.0.6|5.0.12|
|browserslist|4.28.2|4.29.3|
|js-yaml|4.2.0|4.3.2|
|caniuse-lite|1.0.30001797|1.0.30001815|
|electron-to-chromium|1.5.368|1.5.449|
|node-releases|2.0.47|2.0.57|
|update-browserslist-db|1.2.3|1.3.3|

更新後のproduction監査は全重大度0。全依存監査はHigh 5・Critical 0。残るのは修正版なしbraces 3.0.3とmicromatch、fast-glob、@next/eslint-plugin-next、eslint-config-nextへの伝播だけ。runtimeの既知脆弱性ゼロの監査結果を、包括的な安全・非侵害の保証とは扱わない。

更新後にもメイアクト8試験、既存31剤122候補366条件の完全一致（5剤の既存PMDAエラーHTMLも同じ）、lint、build、生成複製だけを除外したソース型検査が成功。生監査結果は `/tmp/drag-audit-updated-all.json` と `/tmp/drag-audit-updated-production.json`。ブラウザUIの必須確認は環境のIAB不在で未実施であり、現時点では公開完了とは扱わない。
