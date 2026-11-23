# AGENTS.md

BluOS プレーヤー（Bluesound など）を操作する Web UI。

## 基本方針

- ユーザーへの回答は日本語で行う。コード中のコメントも日本語で書く（既存コードに合わせる）。
- README は英語（`README.md`、標準）と日本語（`README_ja.md`）の 2 つ。内容を変えたら両方を直す。
- 作業は一区切りごとに動作確認してから git に commit する（ブランチ `main`）。
## 環境

- プレーヤー: BluOS HTTP API（ポート 11000、XML 応答）。アドレスは環境変数 `BLUOS_HOST` で指定する
- Node.js 26 は mise で管理（`mise.toml`）。
- 起動: `npm install && npm start` → http://localhost:3000（`npm run dev` で watch）
- 環境変数: `BLUOS_HOST`（必須。未指定なら起動時にエラー終了）、`PORT`（既定 3000）、`LISTEN`（既定 `0.0.0.0`）
- デプロイ: `docker compose up -d --build`（`Dockerfile` / `compose.yaml` / `.env.example`）。`.env` はコミットしない。
  イメージに入れるのは `package*.json`・`server.js`・`lib/`・`bin/`・`public/` のみ（`.dockerignore`）。コンテナでは PID 1 になるため `server.js` で SIGTERM を処理している

## 構成

- 依存は `fast-xml-parser`（XML→JSON）と `@modelcontextprotocol/sdk`・`zod`（MCP）。バージョンは公開から 2 週間以上たったものを使う（`npm install --before=<日付>`）
- `lib/` — Web サーバー・CLI・MCP で共通の処理
  - `player.js`: `createPlayer(host)` がプレーヤーとの通信（`get` は XML を JSON にし `<error>` を例外にする、`playlistSongs`・`browseAll` はページ送り）。XML の変換設定（`parser`）もここ
  - `actions.js`: CLI と MCP 共通の操作。状態の取得と再生操作まで（キューのクリア・プレイリストの削除・プリセット/アラームの変更は入れない）。
    `playItem` は Browse の playURL・actionURL のうち `/Play`・`/Add` だけを実行する
  - `mcp.js`: `createMcpServer(player)` で MCP のツールを定義（取得系は `readOnlyHint`）。結果は JSON テキスト、失敗は `isError`
  - `cli.js`: `main(argv, { env, stdout, stderr })` が終了コードを返す（`mcp` は stdio で待ち受けを続ける）。入口は `bin/bluos.js`
- `.claude/skills/bluos/` — CLI を使う Agent Skill。`scripts/bluos` は `realpath` でリポジトリの `bin/bluos.js` をたどる（`~/.claude/skills` へのリンクでも動く）。
  CLI のコマンドを変えたら `SKILL.md` も直す（載せたコマンドが CLI にあることは `test/cli.test.js` で確かめている）
- `server.js` — `node:http` で以下を行う。
  - `createServer(player, { proxyTimeout })` を export し、直接実行した時（`import.meta.main`）だけ環境変数を読んで待ち受ける
  - `/mcp` で MCP（Streamable HTTP、ステートレス、POST のみ）。`Origin` が付いていれば同じホストのものだけ受け付ける
  - `public/` の静的配信
  - `/api/d/<BluOS パス>` をプレーヤーへ GET で中継。XML は JSON に変換し、画像等はそのまま返す
  - 中継可能な API は `ALLOWED`（先頭パス要素）で制限。再起動・設定変更系は追加しない
  - XML の数値文字参照（`&#39;` など）も復号するため `htmlEntities: true` にしている
  - `/Info` は last.fm 等への 302 を返すので、追従せず `Location` をそのままブラウザへ返す
  - 中継以外の独自 API（ページ送りをサーバー側でまとめる。ブラウザから細切れに取ると同時接続数を画像と奪い合って遅いため）:
    - `/api/playlist-songs?playlist=` — `/Songs` を offset でたどり全曲を返す
    - `/api/browse?key=&q=` — `/Browse` の `nextKey` をたどり最大 2000 件をまとめて返す（残りがあれば `nextKey` 付き。UI は「さらに読み込む」）
- `public/` — ビルドなしの素の HTML/CSS/JS（ES modules）。フレームワークは導入しない。
  - `app.js`: 再生中表示・操作、キュー（並べ替え・保存）、プレイリスト、プリセット/入力、ブラウズ、コンテキストメニュー
  - メニューは `showMenu(title, loadEntries)` で共通化（`[{ text, fn, danger? }]` を返す関数を渡す）
  - 曲単位の操作は `songMenuEntries(song)`（再生中・キュー・フォルダ共通）。ブラウズはプレーヤー提供のメニューに `browseItemExtras()` を足す
  - DOM は `el()` ヘルパーで生成する（`innerHTML` に外部データを入れない）
  - CSS はトークン（`:root` の変数）でライト/ダーク両対応。幅 820px 以下は 1 カラム
  - PWA としてインストールできるよう `manifest.webmanifest` とアイコン（`icon.svg` と、そこから作った PNG）を置いている。
    Service Worker は使わない（キャッシュで古い UI が残るのを避けるため。インストールにも不要）。
    アイコンを変えたら PNG（192・512・maskable 512・apple-touch-icon 180。maskable と apple-touch-icon は角丸なしの全面塗り）も作り直す
  - タブのバーは `position: sticky` でヘッダー直下に固定（ヘッダーの高さは `ResizeObserver` で `--topbar-h` に設定）。タブ切り替え時は新しいタブの先頭までスクロールを戻す
  - 全画面表示（再生中の曲だけ）は `body.np-full` で `.player` を固定配置に切り替えるだけで、DOM と更新処理は通常時と共通。
    URL の `#nowplaying` と連動（`hashchange` で切り替え、戻るで閉じる）。ディスプレイ全画面（Fullscreen API）は使わない（ブラウザのウィンドウいっぱいまで）。Wake Lock は使えれば使う

## BluOS API の注意点

- 状態追従は `/Status?timeout=90&etag=<etag>` の long polling。サーバー側の中継タイムアウト（130 秒）はこれより長く保つ。
- XML→JSON 変換は属性をそのままキーにし、値はすべて文字列（数値変換しない）。
- 配列化するタグは `ARRAY_TAGS`（`item`, `category`）と `ARRAY_PATHS`（`playlist.song`, `presets.preset`, `playlists.name`, `songs.song`, `folders.subfolders.folder`, `folders.songs.song`）。
  `song` は `/Status` にも単一値として現れるため、タグ名だけで配列化しないこと。
- Browse 応答の `playURL` / `autoplayURL` / `actionURL` はデバイス相対パスなので、そのまま `/api/d` を前置して呼ぶ。
  `browseKey` / `contextMenuKey` / `searchKey` は `/Browse?key=<encodeURIComponent>` で渡す（検索は `&q=`）。
- 入力切替は `/RadioBrowse?service=Capture` の `URL` 属性（エンコード済み）を `/Play?url=` にそのまま付ける。
- 画像パスは `https://` の外部 URL とデバイス相対パスが混在する（`imgSrc()` で吸収）。入力アイコンは白抜き PNG。
- Repeat: `0`=キュー全体, `1`=1 曲, `2`=オフ。
- プレイリスト（BluOS Playlists）:
  - 一覧 `/Playlists`（`<name image="...">名前</name>` → JSON では `{ "#text", image }`）、曲 `/Songs?playlist=<名前>`（曲に id・画像はない。画像は `songid` か `fn` から `/Artwork` を組み立てる）
  - `/Songs` は 1 回に 10 曲しか返さず総数も無い（`&offset=` でページ送り。`start`/`end`/`count` は無視される）。
    ブラウザから 10 曲ずつ取ると画像読み込みと同時接続数を奪い合って遅いので、サーバーの `/api/playlist-songs?playlist=` で全ページをまとめて返す
  - 再生・追加は `/Add?playlist=<名前>&...`。パラメータは `/Services` の BluOS Playlists メニュー定義に合わせる
  - 保存 `/Save?name=<名前>`（現在のキューを保存。同名は上書き）、削除 `/Delete?name=<名前>`
  - 中身を直接編集する API はない。編集は「キューに読み込む → 並べ替え・削除 → 同名で保存」
- Library のメニュー（`/Browse?key=LocalMusic:`）には New・Folders・再スキャンが無いので UI 側で追加している。
  - New: Browse キー `LocalMusic:Album/%2Flibrary%2Fv1%2FAlbums%3Frecent%3D1%26service%3DLocalMusic`
  - 再スキャン: `/Reindex`（公式ドキュメント外）。進行中は `/Status` の `indexing` が 0 以外になる
- フォルダ表示:
  - `/library/v1/Folders?service=LocalMusic[&path=<パス>]`。ルートはフルパス（`//<NAS>/...` など）、以下は親からの相対名が返るので `親/名前` で連結する
  - フォルダ単位は `/Add?service=LocalMusic&path=...`、曲単位は `/Add?service=LocalMusic&file=<fn>`（パラメータは `/Services` の Folder メニューと Browse の曲メニューに合わせる）
- 曲のメニュー（`/Services` の Playqueue / NowPlaying 定義に準拠）:
  - お気に入り `/AddFavourite`・`/DeleteFavourite?fn=<fn>&service=LocalMusic`（ライブラリの曲のみ。状態は `/Status` の `isFavourite`）
  - プレイリストに追加: `/AddToPlaylistOptions?songid=<fn>`（アルバムは `artist`・`album`）で候補を取得し、
    `<urlPath>?<requestParameter を & で連結>&service=<playlists@service>&name=<プレイリスト名>` を呼ぶ（`create="1"` なら新規名も可）
  - `/Info`（last.fm へリダイレクト）と `/Info?filename=&service=&category=technical`（HTML）はライブラリの曲のみ。Amazon は `service method not implemented`
  - アルバム／アーティストへの移動は Browse キー `LocalMusic:MG/LocalMusic-Album?album=&artist=`・`LocalMusic:MG/LocalMusic-Artist?artist=`（`URLSearchParams` 形式）
- スリープタイマー `/Sleep` は引数なしで 15→30→45→60→90→オフを巡回する（応答は新しい値、オフは空）。目的の値まで繰り返し呼ぶ。残り分数は `/Status` の `sleep`。
- プリセット（公式ドキュメント外。BluShell と `/Services` の Add preset 定義を参照）:
  - `/SetPreset?name=&url=&image=` で空き番号に追加、`id` を付けると上書き、`id` だけなら削除。応答は更新後の一覧
  - 並べ替え API はないので、2 件の番号を入れ替えて書き直す。プレイリストの url は `/Load?name=<名前>`、入力は `Capture:...`（`URL` 属性をデコードした値）、ラジオは `/Status` の `streamUrl`
- アラーム（公式ドキュメント外。BluShell 準拠）: `/Alarms?tz=` で一覧、`hour minute days duration volume fadeIn source url image enable` で追加、
  `id` 付きで更新、`id&delete=1` で削除（応答は一覧。応答属性は `fadein` と小文字）。`days` は日曜始まり 7 桁。
  音源は「現在のキュー／局」（`source=Current play queue or station`、url なし）かプリセット（`url`=プリセットの url）
- ストリーミングラジオ（`/Status` に `streamUrl` がある時）はキューを使わない。skip / back / love / ban は
  `/Status` の `<actions><action name url notification/>` が示す URL（多くは `/Action?...`）を呼ぶ。URL の無い操作は無効化する
- キューは `/Playlist?start=&end=` で 200 曲ずつ取得し「さらに読み込む」で追加。再読み込み時は表示済みの曲数を保つ
- お気に入り一覧: ライブラリは分類ごとの Browse キー `LocalMusic:<Song|Album|Artist|Playlist>/%2Flibrary%2Fv1%2F<…>s%3Fcategory=FAVOURITES&service=LocalMusic`、
  TuneIn は `TuneIn:BrowseMenu/%2FRadioBrowse%3Fservice=TuneIn&url=presets`。Amazon Music・BluOS Radio (Airable) には一覧を返すメニューが無い
  （`renderItems(items, { onBrowse, onChange })` で移動先とメニュー操作後の再読み込みを差し替えられる）
- キューの並べ替えは `/Move?old=<位置>&new=<位置>`（キューの `id` は位置そのもの）。
  ドラッグ中に行を DOM 上で動かすとポインターキャプチャが外れるので、move/up は `document` で受ける。

## 動作確認

- API 疎通: `curl http://$BLUOS_HOST/Status` など。中継経由は `curl localhost:3000/api/d/Status`。
- 実機は普段使いされているプレーヤーの可能性があるので、再生・音量などを変える操作を自動テストで勝手に送らない。確認が必要ならユーザーに依頼する。
- テスト: `npm test`（単体 → E2E）。変更したら通ること、カバレッジが下限（行・分岐・関数など 95%）を保つことを確認する。
  - 単体 `npm run test:unit` — `test/*.test.js`（`node:test`）。偽のプレーヤー（`test/fake-player.js`、XML を返す HTTP サーバー）を相手に `server.js`・`lib/` を確かめる。
    MCP は SDK のクライアント（`InMemoryTransport`・HTTP）で、CLI は `main()` を直接呼んで確かめる
  - E2E `npm run test:e2e` — `e2e/*.spec.js`（`@playwright/test`、Chromium）。初回は `npx playwright install chromium`
    - `/api/` 以下はすべて `e2e/mock-player.js` でモックする（`player` フィクスチャは全テストに自動で付く）。サーバーの `BLUOS_HOST` は到達しないアドレスにしてある
    - 応答の差し替えは `player.on(path, handler)`、エラーは `fail()`、状態の変化は `player.setStatus()`、送信 URL の確認は `player.sent()`
    - prompt / confirm は `answerDialog(page, ...値)` で順に答える（`null` は取り消し、答えが無ければ取り消し）
    - カバレッジは `public/app.js` を Chromium の V8 カバレッジで集計（`monocart-coverage-reports`、`coverage/e2e/`）。
      一部の spec だけ実行する時は `COVERAGE_CHECK=0` で下限の確認を外す
  - 状態を変える操作を実機に送らないこと。テストは必ずモックで行う
- `pkill -f "node server.js"` はそれを実行するシェル自身にもマッチして落ちるので使わない。サーバーはバックグラウンドタスクとして起動・停止する。
