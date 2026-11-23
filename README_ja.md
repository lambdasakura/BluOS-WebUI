# BluOS Web UI

[English](README.md) | 日本語

BluOS プレーヤー（Bluesound など）を操作するための Web UI。

## Docker Compose で起動

```sh
cp .env.example .env    # BLUOS_HOST をプレーヤーのアドレスに書き換える
docker compose up -d --build
# → http://<このマシンのアドレス>:3000
```

| `.env` の項目 | 既定値               | 説明                              |
| ------------- | -------------------- | --------------------------------- |
| `BLUOS_HOST`  | （必須）             | 操作するプレーヤー（ホスト:ポート） |
| `WEB_PORT`    | `3000`               | Web UI を公開するホスト側のポート   |

- `BLUOS_HOST` は必須。未指定だと `docker compose up` がエラーになる
- 停止は `docker compose down`、更新後の再構築は `docker compose up -d --build`
- コンテナは `restart: unless-stopped` なので、マシンの再起動後も自動で立ち上がる
- コンテナからプレーヤー（LAN 上の `BLUOS_HOST`）へ HTTP で届く必要がある（通常のブリッジネットワークで可）

### プレーヤーの IP アドレスを調べる

`BLUOS_HOST` に指定するアドレスは、公式アプリ BluOS Controller の Diagnostics（診断）画面で確認できる。ポートは `11000` なので、`<IP アドレス>:11000` と指定する。

- **iOS・Android**: Players タブで対象のプレーヤーを選び、Home タブ → Settings → Help & Support の Diagnostics
- **Windows・macOS**: 左のナビゲーションドロワーで Help → Diagnostics

Diagnostics 画面には同じネットワーク上の他のプレーヤーの IP アドレスも表示される。アプリのバージョンによってメニュー名が少し異なることがある（メニュー名は公式サポートの英語表記。[公式サポートの記事](https://support.bluos.net/hc/en-us/articles/360000463947-How-do-I-find-the-IP-Address-of-my-Player)）。
IP アドレスが変わると接続できなくなるので、ルーターの DHCP 設定でプレーヤーに固定のアドレスを割り当てておくとよい。

`curl http://<IP アドレス>:11000/SyncStatus` でプレーヤー名などの XML が返れば正しいアドレス。

## アプリとして追加する

Chrome・Edge などでは、タスクバーやホーム画面に追加して独立したウィンドウで開ける（PWA）。

- Chrome: アドレスバー右端のインストールボタン、または「︙ → キャスト、保存、共有 → ページをアプリとしてインストール」
- Edge: 「… → アプリ → このサイトをアプリとしてインストール」
- iPhone / iPad の Safari: 共有 →「ホーム画面に追加」

ブラウザが正式なインストールを許可するのは、HTTPS か `localhost` で開いた時だけ。
`http://<LAN のアドレス>:3000` のままでは、インストールボタンが出なかったり、ブラウザによっては
ウィンドウで開くショートカットとして追加されたりする。正式にインストールしたい時は、リバースプロキシで HTTPS にする。

## 開発用に起動

```sh
mise install        # Node.js 26
npm install
BLUOS_HOST=<プレーヤーのアドレス>:11000 npm start   # http://localhost:3000
```

| 環境変数     | 既定値               | 説明                     |
| ------------ | -------------------- | ------------------------ |
| `BLUOS_HOST` | （必須）             | プレーヤーのホスト:ポート |
| `PORT`       | `3000`               | Web UI の待ち受けポート   |
| `LISTEN`     | `0.0.0.0`            | 待ち受けアドレス          |

## CLI

プレーヤーへ直接つなぐコマンド `bluos`。Web サーバーが動いていなくても使える。

```sh
npm link                       # bluos コマンドを使えるようにする（プロジェクト内なら node bin/bluos.js でも可）
export BLUOS_HOST=<プレーヤーのアドレス>:11000   # または --host で指定
bluos                          # 再生状態
bluos pause / bluos play / bluos next
bluos volume 30 / bluos volume +5 / bluos volume -5
bluos play-playlist Favorites --mode shuffle
bluos search queen             # 検索（--service Amazon などでサービスを指定）
bluos --json queue             # JSON で出力
bluos --help                   # すべてのコマンド
```

Docker で動かしている場合は `docker compose exec bluos-web bluos status` のようにコンテナ内でも使える。

## Agent Skill

`.claude/skills/bluos/` は、AI エージェント（Claude Code など）に CLI の使い方を教える Agent Skill。
「今何が流れてる？」「音量を下げて」「〇〇を流して」などと頼むと、エージェントが `bluos` コマンドで操作する。

- このリポジトリ内で Claude Code を使う時は自動で読み込まれる
- 他の場所でも使うなら、ユーザーのスキルとしてリンクする:
  `ln -s <このリポジトリ>/.claude/skills/bluos ~/.claude/skills/bluos`
- プレーヤーのアドレスは環境変数 `BLUOS_HOST` で渡す（無ければエージェントが尋ねる）
- スキルの `scripts/bluos` がリポジトリの `bin/bluos.js` を呼ぶので、`npm install` 済みであること

MCP サーバーと同じく、扱うのは状態の取得と再生操作まで。

## MCP サーバー

AI エージェント（Claude Code・Claude Desktop など）から再生状態を調べたり、再生を操作したりできる。
扱うのは状態の取得と再生操作まで（再生・一時停止・次へ・音量・シーク・シャッフル・リピート・検索した曲やプレイリストの再生・キューへの追加）。
キューのクリア、プレイリスト・プリセット・アラームの変更はできない。

stdio（手元で起動する）:

```sh
claude mcp add bluos --env BLUOS_HOST=<プレーヤーのアドレス>:11000 -- node <このリポジトリ>/bin/bluos.js mcp
```

HTTP（起動中の Web サーバーの `/mcp`。Docker で動かしている場合など）:

```sh
claude mcp add --transport http bluos http://<Web サーバーのアドレス>:3000/mcp
```

`/mcp` は Web UI と同じく認証が無く、LAN 内の誰でもプレーヤーを操作できる（Web UI と同じ範囲）。
他のサイトのページからブラウザ経由で呼ばれないよう、`Origin` ヘッダーが付いたリクエストは同じホストからのものだけ受け付ける。

## テスト

```sh
npx playwright install chromium   # 初回のみ（E2E 用のブラウザ）
npm test                          # 単体テスト → E2E テスト
npm run test:unit                 # server.js・lib/ の単体テスト（node:test）
npm run test:e2e                  # ブラウザでの E2E テスト（Playwright）
```

- 単体テストは偽のプレーヤーを、E2E はブラウザ側で API をすべてモックして動かすので、実機は不要（実機には何も送らない）
- カバレッジは単体（`server.js`・`lib/`）・E2E（`public/app.js`）それぞれ 95% を下限とし、下回るとテストが失敗する。
  E2E のレポートは `coverage/e2e/`。一部の spec だけ実行する時は `COVERAGE_CHECK=0 npx playwright test e2e/queue.spec.js` のように下限の確認を外す

## 構成

- `Dockerfile` / `compose.yaml` — `node:26-alpine` ベースのイメージ（非 root で実行、ヘルスチェック付き）
- `server.js` — 静的配信と BluOS API の中継。`/api/d/<BluOS パス>` をプレーヤーへ転送し、XML 応答は JSON に変換する（画像はそのまま中継）。中継できる API は `ALLOWED` で制限。`/mcp` で MCP サーバー（HTTP）も提供する。
- `lib/` — プレーヤーとの通信（`player.js`）、CLI・MCP 共通の操作（`actions.js`）、MCP のツール定義（`mcp.js`）、CLI（`cli.js`）
- `bin/bluos.js` — CLI の入口（`bluos mcp` で stdio の MCP サーバー）
- `.claude/skills/bluos/` — CLI を使う Agent Skill（`SKILL.md` と、CLI を呼ぶ `scripts/bluos`）
- `test/` — `server.js`・`lib/` の単体テスト（`fake-player.js` が偽のプレーヤー）、`e2e/` — E2E テスト（`mock-player.js` が API のモック）
- `public/` — フロントエンド（ビルド不要の素の HTML/CSS/JS）
  - 全画面の再生中表示（⛶ かアートワークのクリック、`/#nowplaying` で直接開ける）
  - 再生中表示・再生/一時停止/前後/シーク/音量/ミュート/シャッフル/リピート・お気に入り
  - 曲のメニュー（再生中・キュー・ブラウズ・フォルダ）: お気に入り、プレイリストに追加、アルバム/アーティストへ移動、曲情報、技術情報
  - キュー（選曲・削除・クリア・ドラッグで並べ替え・プレイリストとして保存）
  - プレイリスト（一覧・曲表示・再生/シャッフル/次に追加/最後に追加・削除）
  - お気に入り（ライブラリの曲・アルバム・アーティスト・プレイリスト、TuneIn の局）
  - プリセット・入力切替（プリセットの追加・並べ替え・名前変更・削除）
  - スリープタイマー、アラーム
  - ブラウズ（ライブラリ・Amazon Music・ラジオ等、検索、コンテキストメニュー、ライブラリの New・フォルダ表示・再スキャン）

再生状態は `/Status?timeout=90&etag=...` の long polling で追従する。

## ライセンス

[MIT License](LICENSE)
