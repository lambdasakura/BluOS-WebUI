---
name: bluos
description: BluOS プレーヤー（Bluesound・NAD など）を CLI で操作する。再生中の曲の確認、再生・一時停止・停止・次の曲・前の曲、音量・ミュート、シーク、シャッフル・リピート、キュー・プレイリスト・プリセットの表示と再生、ライブラリや Amazon Music などの検索・ブラウズと曲の再生・キューへの追加を行う。「今何が流れてる？」「音楽を止めて」「音量を下げて」「〇〇を流して」「プレイリストを再生して」など、音楽の再生や BluOS・Bluesound に関する依頼で使う。
---

# BluOS プレーヤーの操作

このスキルの `scripts/bluos` で BluOS プレーヤーを操作する（リポジトリの `bin/bluos.js` を呼ぶ。Node.js 26 が必要）。
以下の `bluos` は `<このスキルのディレクトリ>/scripts/bluos` のこと。PATH に `bluos` コマンド（`npm link` で入る）があればそれでもよい。

## 接続先

プレーヤーのアドレスは環境変数 `BLUOS_HOST`（例 `192.168.1.100:11000`）か `--host` で指定する。
`BLUOS_HOST` が無く、プロジェクトの `.env` や `CLAUDE.local.md` などにも書かれていなければ、ユーザーに尋ねる（推測しない）。

## 進め方

- まず `bluos` （= `bluos status`）で現在の状態を確認してから操作する。
- 状態を変える操作（再生・停止・音量・キューへの追加など）は、ユーザーがそう頼んだ時だけ行う。
  普段使いのプレーヤーなので、確認や試しのために勝手に鳴らしたり止めたりしない。
- 操作系のコマンドは操作後の状態を表示するので、それを見て結果を短く伝える。
- プログラムで扱いたい時は `--json` を付ける（例 `bluos --json queue`）。

## コマンド

```sh
bluos                                  # 再生状態（曲名・アーティスト・位置・音量・シャッフル・リピート）
bluos play | pause | stop              # 再生・一時停止・停止
bluos next | prev                      # 次の曲・前の曲（ラジオは局が対応している時だけ）
bluos volume                           # 音量の表示
bluos volume 30 | +5 | -5              # 音量の設定・増減（0〜100）
bluos mute | unmute
bluos seek 1:30                        # 再生位置（秒か 分:秒）
bluos shuffle on|off
bluos repeat all|one|off
bluos queue [--start N] [--count N]    # キュー（行頭の番号を play-track に渡す）
bluos play-track 5                     # キューの 5 番の曲を再生
bluos playlists                        # プレイリスト一覧
bluos playlist <名前>                   # プレイリストの曲
bluos play-playlist <名前> [--mode now|shuffle|next|last]
bluos presets                          # プリセット一覧（行頭の番号を preset に渡す）
bluos preset 1
bluos search <検索語> [--service LocalMusic|Amazon|TuneIn|...]   # 既定はライブラリ
bluos browse [<browseKey>]             # 省略するとソースと入力の一覧
bluos menu <contextMenuKey>            # 項目のメニュー（今すぐ再生・次に追加・最後に追加など）
bluos play-item '<playURL か actionURL>'   # /Play・/Add で始まる URL だけ実行できる
```

キーや URL には `&` などが含まれるので、必ずシングルクォートで囲む。

## 曲・アルバムを探して流す

1. `bluos search 'queen'` で検索する。ライブラリでは Artists・Albums・Songs などの分類が `browseKey` 付きで返る。
2. 目的の分類を `bluos browse '<browseKey>'` で開く。`（続きあり: …）` が出たらそのコマンドで続きを見る。
3. 見つけた項目の扱い:
   - すぐ再生する: `bluos play-item '<playURL>'`
   - 次に再生・最後に追加など: `bluos menu '<contextMenuKey>'` でメニューを開き、目的の項目の `actionURL` を `bluos play-item` に渡す
   - さらに下の階層（アルバムの曲など）: `bluos browse '<browseKey>'`
4. 入力の切り替え（光デジタル・HDMI など）は `bluos browse` のルートにある入力の `playURL` を `play-item` に渡す。

Amazon Music の検索は「Amazon Music」（カタログ）と「マイミュージック」の分類が返るので、目的に合う方を開く。

## できないこと

キューのクリア、プレイリストの保存・削除、プリセットやアラームの変更、お気に入りの追加・削除はこの CLI では行えない。
頼まれたら、Web UI（このリポジトリの `npm start` で起動する画面）から行うよう案内する。

## エラー

- `<ホスト> に接続できません`: アドレスの誤りか、プレーヤーの電源・ネットワークを確認するよう伝える。
- `この局では「次へ」を使えません`: 再生中のラジオ局がスキップに対応していない。
- 終了コード 2 は引数の誤り（使い方が表示される）。`bluos --help` で確認する。
