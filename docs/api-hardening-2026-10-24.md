# PMDA解析APIの取得境界・資源上限（2026-10-24）

## 範囲と基準

- 対象は公開POST `/api/parse-pmda` と関連parser。ユーザー承認により通常commit/pushと既存Git連携の本番公開まで実施する。
- 修正前: `118fb33d31e8c2931c910dd44004b3dad6ebfeee`、main、開始時差分なし。
- 修正前の本番: `dpl_DW3HvkJPcromdPUrNooqBxfvS53n`、production / READY、上記SHA。正規Vercel APIで確認した。
- 実行: DUMS2022、`/Users/daishin/Documents/Codex/Drag`、担当タスク `01a11924-b2b5-7511-ba0e-a6bbdd70e567`。
- 薬物モデル、薬剤データ、UI、認証仕様、依存manifest/lockfileは変更しない。医学的妥当性・個人予測・安全性を保証する修正ではない。
- モデルは依頼元が `gpt-6.1-sol / high` を正式指定。実runtime設定の独立確認項目は取得できず、実モデルを確認済みとは扱わない。

## 取得先の制御

正確な `https://www.pmda.go.jp` の既定443と、数字6桁・英数字12桁・改訂番号から成る既存ResultDataSetXMLパスだけを許可する。userinfo、query、fragment、別port、余分なpathは拒否する。URL中に認証値を受け付けない。

`https.request` の実接続用lookup内で全DNS結果を検査し、その検査済みアドレスだけを返す。別の事前照会結果に依存した再解決はしない。private、loopback、link-local、共有・予約・文書用アドレスやIPv4 mapped/NAT64/6to4等は保守的に拒否する。接続再利用を止め、TLS証明書検証と許可hostのservernameを保持する。受信Cookie/Authorizationを外部へ渡さない。

3xxは同一hostも含め全拒否し、Locationへ接続しない（転送上限0）。確認した正規2資料は直接200であり、必要な転送は確認されていない。将来PMDAが必須転送を導入した場合は再評価が必要。

## 選んだ上限

| 対象 | 上限 |
|---|---|
| JSON本文 / URL | 実受信4 KiB / UTF-8 512 B |
| 入力deadline / 外部取得deadline | 3秒 / DNS・TLS・ヘッダー・本文全体15秒 |
| ZIP受信 | 実受信8 MiB（Content-Lengthも事前確認） |
| ZIP metadata | 256項目、宣言展開総量32 MiB、XMLは1件だけ |
| XML実展開 | 4 MiB、deflate出力上限を展開処理に指定 |
| XML構造 | 深さ96、タグ100,000、DTD/独自entity拒否 |
| 表展開 | 1表4,096行、列結合128、全表100,000セル・論理文字量4 MiB |
| API要求 | warmインスタンス内60回/60秒かつ12回/10秒、入力待ち・共有待ちを含め同時8件 |
| 外部取得 | 同30回/60秒かつ6回/10秒、異なる資料の同時処理2件 |
| JSON応答 | 1 MiB、全体の文字列化より前にエスケープを含む予算を検査 |
| 正常結果cache | 同一公開URL、TTL60秒、16件かつ2 MiB、LRU |

回数制限は時間窓の履歴を有界に保持する。上限では429とRetry-Afterを返す。同一URLの進行中取得は共有し、成功cache/共有待ちは外部取得予算を消費しない。全要求にはAPI要求制限を適用する。失敗時・入力timeout後も枠を解放し、無限待機queueは作らない。

今回、既知の正規資料を通常取得してメモリ上で測定した結果:

| 資料ID | ZIP bytes | 項目 | 宣言展開総bytes | XML bytes | 候補 |
|---|---:|---:|---:|---:|---:|
| 780009_6132015F1037_1_11（メイアクト） | 63,414 | 7 | 124,362 | 72,110 | 2 |
| 400059_6149003F2038_1_38（クラリス） | 40,145 | 5 | 200,534 | 184,542 | 12 |

この2資料に十分な余裕を持つ容量とし、1操作ごとに解析する現在のUIに対し小さなburstを許す保守的な暫定値を選んだ。網羅的な全資料最大値や実利用統計から導いたものではない。実URL39件の文字列は許可形式に適合（URL案内の省略記号は除外）。全39資料の再取得は行っていない。

ZIPはCentral Directoryとlocal headerを展開前に検査し、暗号化・ZIP64・分割・不正path・複数XMLを拒否する。画像は一切展開せず、必要なXMLだけを実出力上限付きで読み、サイズ・CRCも照合する。ディスクへ展開しない。XMLを小さく制限した上で構造と表展開を制限する。同期parser自体をworkerで強制中断する仕組みは追加しておらず、XML解析CPUの厳密なwall-clock上限ではない。

公開例外は分類済みの日本語メッセージとerrorCodeに統一し、生のerror.message/stack/設定/内部URLを返さない。失効URLのHTMLは署名受信時に早期拒否する。公開PMDA結果だけをcacheし、入力本文や健康情報のログ・永続保存は追加しない。

## 検証

- `npm test`: 38件、37成功・1skip。skipは任意の保存済み実ZIP fixtureが未配置の既存試験。別途実URLの正常取得・解析を実施。
- 小さなfixtureとオフラインmockで、URL/アドレス拒否、実接続lookupへの適用、転送拒否、入力/受信/宣言/実展開/構造/表/応答容量、timeout、cache/共有、回数・同時制限と失敗後解放、固定公開例外を検証。内部宛てへ実接続していない。
- `npm run lint`、`git diff --check`: 成功。
- 元の作業フォルダの型検査は、既存 `.next/types/cache-life.d 3.ts` 等の生成複製による重複定義で失敗。既存物を削除・移動せず、追跡ソースと今回の新規ソースをコピーした隔離領域で `npm run build` と元設定の `npx tsc --noEmit --incremental false --pretty false` が成功した。
- 隔離領域: `/Volumes/Media/CodexScratch/Drag/20261024-api-hardening-01a11924/validation`。同一package/lockを `npm ci --ignore-scripts` で導入。ソース正本は元リポジトリ。再生成物の所有・用途・保持・片付け条件はrunのRUN.mdへ記録。
- メイアクトの同じ正常応答を旧SHAのparserと新parserへ渡し、出力全体のdeepEqualが成功。PK計算の既存試験も成功。
- 内蔵ブラウザで通常のカード選択→API解析→100/200mg候補選択→グラフ描画を確認。PC1280px・スマホ390pxで横overflowなし、エラーoverlayなし、関連console error/warnなし。最終公開後の確認は下記公開記録へ追記する。
- `npm audit --omit=dev`: 指摘0件。全依存では開発用eslint-plugin-react-hooks経由のZod 4.4.3にHigh1件（[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)、修正版4.6.6）。APIのnft traceにzodなし。依存更新は今回の範囲外として残す。包括的な安全保証ではない。
- 本番への攻撃・異常入力・内部接続・負荷試験、大規模取得、新規資格情報発行、env内容の読取り、管理APIの生応答保存は行わない。

## 適用範囲の限界・別承認が必要な点

回数・同時実行・外部取得予算・cacheは**warmプロセス/インスタンス単位**。cold startでリセットされ、複数インスタンス・リージョン・deployment間では共有されない。サイト全体やPMDA宛て総量の分散上限を達成したとは扱わない。公開APIの利用停止や基盤課金の絶対上限も保証しない。

強い分散制御は、既存Vercel project `prj_9YbZGfTorhzbvFIkyXnnzt1IGH7g` のFirewallで `/api/parse-pmda` の機能別rate limit等を設定するか、共有budget基盤を用いる検討が別途必要。現planの機能・費用・既存ルールとの関係・権限を確認した上で、設定変更について別承認を得る。今回はWAF/認証/課金/外部サービス設定を変更しない。単一IP制限だけでも全体総量の保証にはならない。

## 公開と復旧

公開は通常のmainへのcommit/pushと既存Git連携を用いる。本番deployment READY・production・commit・既存aliasを正規APIの非秘密metadataだけで照合し、既知の正常資料1件と画面を確認する。具体的な公開SHA・deployment・日時と結果は、この会話に記録する。

復旧基準は前述のSHAと旧deployment。必要時は今回の修正commitを通常の `git revert <修正commit>` で取り消してpushし、Git連携の再公開を同じ方法で検証する（force/resetは不要）。即時rollbackは旧deploymentへの切替を対象・状況に即して判断する。今は復旧操作を行わない。Git内の旧コードと公開対応を保全し、原資料や秘密を含む新規backupは作らない。
