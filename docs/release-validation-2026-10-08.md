# 2026-10-08 修正・公開前検証

DUMS2022、`/Users/daishin/Documents/Codex/Drag`、main、開始HEAD `37e3ae11a6a24697201ca7be30badc4ad6364d57`、未コミット差分なしから開始。ユーザーの修正・コミット・push・公開依頼に基づく。GitHub mainは正規ネットワーク読取で `7ea9fc67b72ebe2169f4b5a9bb3523eaefda5701` を確認。

## 修正

失効した5剤のカードXML URLを同一製品の現行文書に更新。パーサと薬物動態モデルは今回変更しない。

|例|文書ID|実API候補数|濃度単位|
|---|---|---:|---|
|カロナール|172190_1141007F1063_5_07|4|μg/mL|
|アムロジピンOD「NS」|530113_2171022F3080_2_19|12|ng/mL|
|アレロックOD|230124_4490025F3026_1_10|2|ng/mL|
|オランザピンOD「トーワ」|480235_1179044F4109_1_13|6|ng/mL|
|アリピプラゾール「ニプロ」|530100_1179045B1072_1_16|21|ng/mL|

APIはHTTP 200で返るPMDAエラーHTML・空応答をZIP実体の先頭署名で識別し、HTTP 502と最新XML URLの確認を促す日本語メッセージを返す。application/octet-streamでもZIP実体なら受け入れる。

## 確認結果

- 実メイアクトZIPを含む `npm test`: 9件成功、スキップ0。追加の取得境界試験はHTML・空応答・octet-stream ZIP・HTTP 404・外部URL拒否を検証する。ZIP判定試験ではパーサだけスタブにし、実解析は実ZIP試験とAPI確認で検証。
- `npm run lint`、`npm run build`、元tsconfigによる `node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false`、`git diff --check`: 成功。以前の生成複製は今回の型検査で再現せず、設定変更・生成物削除は行っていない。
- 完成ビルドのローカルAPIで上記5剤とメイアクトを実PMDA URLから解析、全てHTTP 200。メイアクトは100mg/200mgの独立2候補、Cmax 1.66/3.44 μg/mL、tmax 1.4/2 hr、半減期0.80/1.06 hr、旧錠剤・食後・健康成人のラベルを確認。
- 5剤の用量・水あり/なし・生物学的同等性試験・単回/反復の候補ラベルと濃度/時間単位を確認。ただし既存アリピプラゾールの一部の候補名は製品名・用量が省略され、反復投与候補もある。候補取得成功は全候補の臨床的な解釈の保証ではない。既存モデルへの反復投与値の適用やラベル補完の包括的改修は今回行っていない。
- 失効したカロナール旧URLはHTTP 502と日本語取得エラー。PMDA以外のURLはHTTP 400で拒否。
- Codex内蔵ブラウザでローカル完成ビルドを確認。メイアクトカード選択・解析、100mg→200mg切替（表示Cmax 1.66→3.44）、比較オンで2本・オフで標準のみ、AUC非再現と出典条件表示を確認。1440×1000と390×844の指定幅で主要画面とグラフを視認。スマホのdocument clientWidth/scrollWidthは375/375。空白・エラーオーバーレイなし、取得したwarn/errorコンソールログ0件。全カードのブラウザ操作確認ではない。

## 依存の残件

今回のnpm公式監査は全依存High 5・Critical 0、本番依存は全重大度0。原因はbraces 3.0.3の[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)とmicromatch、fast-glob、@next/eslint-plugin-next、eslint-config-nextへの伝播。2026-10-08の公式告知は修正版None。強制版指定、major降格、指摘を隠す変更はしない。

完成ビルドのAPI nft traceにbraces/micromatch/fast-glob/ESLintは含まれない。今回のPMDA入力からこれらへの経路は確認されない。未信頼のglobパターンを開発ツールに渡す条件は別であり、包括的な安全保証ではない。依存更新は既存37e3ae1の内容を公開する。

小さな実XML ZIPと監査JSONは `/private/tmp/drag-meiact-20261008.zip`、`/private/tmp/drag-audit-20261008-{all,prod}.json` にローカル検証用として置いた。Git対象ではない。大量ダウンロード・動画・画面画像の保存、既存物の整理・削除は行わない。再現に必要なコマンドと結果は本書をGit管理する。

## 公開対象

Vercel正規読取で `dueyama's projects` (`team_wKom5ONH8e5jfOn0BZdTMfp1`) の `pmda-pk-curve-viewer` (`prj_9YbZGfTorhzbvFIkyXnnzt1IGH7g`) と既存production alias `https://pmda-pk-curve-viewer.vercel.app` を確認。mainへの通常Git pushで公開する。
