# Next.js 16.4.5更新・公開前検証（2026-11-06）

## 状態と範囲

- **公開前検証合格**。ローカル更新とCLI/HTTP検証に続き、正式な既存Chrome接続で実ブラウザ検証を完了。承認済みの通常commit/push・既存production配備へ進む。配備結果は下記へ追記する。
- 本人の「Next.jsやっておこう。指示していって。」を依頼元 `01a15de3-3dc1-762c-aa6f-825772541036` から受領。通常commit/pushと既存URL・公開範囲への配備まで承認済み。追加の認証・権限・設定変更はしない。
- 実行: DUMS2022/local、`/Users/daishin/Documents/Codex/Drag`。担当タスク `01a104b2-271d-7e92-8139-575bb6c6a8d4`。確認開始2026-11-06 08:22 JST、公開保留の記録08:27 JST。
- 現行MODEL_SELECTION（2026-10-21適用）はgpt-6.1-sol/medium以上。前回の正式指定はgpt-6.1-sol/high。今回の既存設定維持指示に従い設定変更していない。現在ターンのmodel/effortを正式APIで独立実測する項目は取得できず、実設定の適合や実モデル確認済みとは扱わない。
- repoのAGENTS.mdを確認。repoと直上の `.agents` / `.codex` は存在しない。API担当の正式waitはnotLoaded・直近turn completedで、重複作業の進行は検出されなかった。

## 更新前・復旧基準

- main / HEAD / remote main: `ad5b5d9fcc876e2c99bc6cd7763619a735e7df9c`。開始時dirtyなし。
- 更新前lockのSHA256: `0b04e86bc108c114c0ab738264595deae43984c35b75ea3974690acf4e00b07d`。元lockは上記Git commitに保持。
- 既存production: `dpl_BLooRANmQWyS1EnsA5MPHcqG9Pjm`、READY、source=git、上記commitと一致。
- deployment URL: <https://pmda-pk-curve-viewer-e0ppv3m9y-dueyamas-projects.vercel.app>
- 公開alias: <https://pmda-pk-curve-viewer.vercel.app/>。正規APIで割当・production・commitを照合。
- team: `team_wKom5ONH8e5jfOn0BZdTMfp1`、project: `prj_9YbZGfTorhzbvFIkyXnnzt1IGH7g`。
- 配備前の復旧参照は上記Git commit/lock/deployment。現時点では本番変更なし。将来更新を公開した後に問題があれば、更新commitの通常revertによる再配備、またはこの既存deploymentへの切替を対象と状況に応じて判断する。復旧操作は未実施。API安全対策を含むad5b5d9より古い版へ戻さない。

## 公式照合と最小差分

- [公式11月告知](https://nextjs.org/blog/november-2026-security-release)を通常HTTP 200で再取得し、16.4.5/15.5.29の修正案内を確認（Web取得ツールでは同ページを読めなかった）。[公式16.4.5リリース](https://github.com/vercel/next.js/releases/tag/v16.4.5)も照合。
- npm registryはnextのlatest=16.4.5、next/eslint-config-next 16.4.5の実在、非deprecated、Node >=20.9.0、React 18/19 peerを確認。
- next 16.4.5のregistry integrityとlockが一致: `sha512-rmdfsWosjTUO+6R0S3KokoIk6Kj0sWDRTe86tZHdqaWH/oXq/udX3/4xb+YQi7aWbyEFoglDU54kaifLCdXbBw==`。
- `npm install --ignore-scripts 'next@^16.4.5' 'eslint-config-next@^16.4.5'` を実施。manifest/lock/導入実体でNextとESLint configが16.4.1→16.4.5、必要な@next/env/plugin/SWCも同版で一致。
- React/ReactDOMは19.2.7→19.2.7、sharpは0.35.5→0.35.5。無関係な一括更新なし。変更したバージョンはNext系列のみ。
- Next内蔵React/ReactDOMはともに `19.3.0-canary-278794d7-20261002`。同梱RSC webpack/turbopackのpeerも同値。アプリ直依存の19.2.7と同梱版を混同しない。16.4.5としてbuild成功。RSCの独自差替えなし。
- `src/`・`tests/`・next.config.tsの差分なし。10/24のidentity要求、非identity応答の読込前拒否、宛先/DNS/redirect検査、回数/同時実行/容量/時間制限、固定エラーを維持。公開/認証/データ/機能の変更なし。

## 検査結果

|検査|結果|
|---|---|
|`npm run lint`|passed|
|`npm test`|38件、37 passed / 1 skipped / 0 failed|
|`npm run build`|passed、Next.js 16.4.5、TypeScript段階も成功|
|`./node_modules/.bin/tsc --noEmit --incremental false --pretty false`|passed|
|`git diff --check`|passed|
|`npm audit --omit=dev --json`|全重大度0|
|全依存audit|Moderate 8 / High 1。開発用minimatchとTypeScript ESLintへの伝播、Zod。包括的な安全保証ではない。範囲外のforce修正・major降格は行わない|
|API安全装置の既存fixture/mock|passed。実際の内部宛接続や負荷試験なし|
|追加の一時オフラインmock|identity要求を確認。encoding省略/identityの正常ZIPを受入れ、br/gzipはdata配信0回でINVALID_DATASETとなりdestroyされることを確認。ソース変更なし|
|ローカル通常HTTP|`127.0.0.1:3107`の本番ビルドでGET / 200、既存5薬剤名・安全文言を確認。メイアクトの正常POST 200、2候補、Cache-Control: no-store|
|既存本番の通常HTTP|GET / 200、既存5薬剤名・安全文言。メイアクト正常POST 200、2候補、no-store。ただし更新前の本番に対する確認|
|ブラウザ画面・解析・曲線・比較・印刷・PC/スマホ・console|passed。専用Chromeタブでローカル16.4.5の実解析、100→200mg候補切替、比較の明示オン、曲線追加、印刷ページとツール復帰を確認。PC1280pxと390pxで主要表示を画像確認。console error 0、警告はMetaMask拡張のcontent script由来のみ。印刷ページ表示の確認であり、紙への出力は行わない|
|commit / push / 新production配備|公開前検証合格後に実施。具体的結果は下記へ追記|

任意の実ZIP fixtureを要求する既存1件は未配置でskip。通常HTTPで実PMDA取得・解析を別途確認したが、このfixture試験そのものが成功したとは扱わない。localhost確認サーバーは本タスクが起動し、確認後に停止済み。原資料・秘密・個人データ・新規backup・大容量証跡は保存していない。このGit管理文書とチャットのツール結果が実行記録。

## Nodeの区別

- Vercel project設定は24.xを正規APIで確認。既存deploymentのbuild logはNext 16.4.1を示すが、Node実build patchは記載なし。実runtime patchも未確認。新しい診断endpointや秘密の読取りは行っていない。
- [Vercel公式Node告知](https://vercel.com/kb/bulletin/node-js-security-advisory)は10/28 11am PT（10/29 03:00 JST）以降の全new deploymentが修正済みNodeを使うと記載。24系列の修正版は24.22.1。providerの記載であり、この関数のruntime独立測定ではない。
- 現productionの作成は10/24、上記日時より前。今回の新deploymentはまだ作成しておらず、今回再配備でprovider条件を満たしたとは報告しない。
- ローカル検証Nodeはv26.13.0。Vercelのbuild/runtime版を示す値ではない。OS/システムNode更新なし。

## ブラウザ利用の切り分けと再開

- 初回の `cua.createBrowserTab("iab", ...)` は `Browser is not available: iab`。正式inventoryにIABがなく、機能/接続未提供というavailability上の保留。権限拒否は検出しておらず、サービス側の原因は未確認。
- 依頼元から、利用可能かつ許可されたブラウザ・導入済みUI test手段で続行する指示を受領。現行AGENTSは内蔵優先でChrome禁止ではない。repoにはPlaywright/Puppeteer等のUI test設定・依存はなく、既存testはparser/model/APIのfixture/mock中心だった。
- 正式inventoryの既存Chromeを使用。初回タブ作成はtimeoutだったが作成済みをinventoryで確認し、重複作成しなかった。wrapperの `getTab` はCDP Target.setAutoAttachでtimeout。ネイティブ画面操作では正規localhostを開けたが、別タブへの表示変更も観測し、その後はネイティブで無関係なタブを操作していない。
- 読み込み済みの専用タブを、正式ドキュメントにある `browser.tabs.get` / Playwright APIで直接指定すると接続できた。個別の読取り/入力応答にはCDP timeoutがあったが、後続のDOM snapshotで実行結果を確認し、状態変更を重複させなかった。UI上の機能失敗と通信timeoutを混同しない。
- 新規browser/tool導入、非公式session、認証・権限変更、実際の拒否の迂回は行っていない。内蔵不在を他の許可済み手段の禁止へ拡張しない。

## 公開結果

公開前検証を完了した状態の記録。通常commit/push後の新productionについてREADY・full commit・alias・公開時刻・正常HTTP/主要操作を確認し、結果を追記する。
