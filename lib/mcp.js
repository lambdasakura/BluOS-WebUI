// MCP サーバー（ツールの定義）。stdio（bin/bluos.js mcp）と HTTP（server.js の /mcp）で共通に使う。
// 扱う範囲は lib/actions.js と同じく状態の取得と再生操作まで
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import pkg from '../package.json' with { type: 'json' };
import * as actions from './actions.js';

const READ = { readOnlyHint: true, openWorldHint: false };
const CONTROL = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

// 結果は JSON のテキストで返し、失敗はツールのエラー（isError）として返す
const run = (fn) => async (args) => {
  try {
    return { content: [{ type: 'text', text: JSON.stringify(await fn(args), null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `エラー: ${err.message}` }] };
  }
};

// player: createPlayer() の戻り値
export function createMcpServer(player) {
  const server = new McpServer({ name: 'bluos', version: pkg.version }, {
    instructions: 'BluOS プレーヤーの状態を調べ、再生を操作するツール群。'
      + '曲・アルバムを探して再生するには search（または browse）で項目を探し、playURL を play_item に渡す。'
      + '次に再生・最後に追加などは item_menu で項目のメニューを取り、その actionURL を play_item に渡す。'
      + 'キューのクリア、プレイリスト・プリセット・アラームの変更はできない。',
  });
  const tool = (name, title, description, inputSchema, annotations, fn) =>
    server.registerTool(name, { title, description, inputSchema, annotations: { title, ...annotations } }, run(fn));

  // ── 取得 ──
  tool('get_status', '再生状態', '再生中の曲・状態（play/pause/stop など）・再生位置（秒）・音量・シャッフル・リピートを返す',
    {}, READ, () => actions.status(player));
  tool('get_queue', 'キュー', '再生キューの曲を返す。index は play_queue_track に渡す番号',
    { start: z.number().int().min(0).default(0).describe('取得を始める位置（0 始まり）'),
      count: z.number().int().min(1).max(200).default(50).describe('取得する曲数') },
    READ, ({ start, count }) => actions.queue(player, { start, count }));
  tool('list_playlists', 'プレイリスト一覧', 'BluOS に保存されているプレイリストの名前を返す',
    {}, READ, () => actions.playlists(player));
  tool('get_playlist', 'プレイリストの曲', 'プレイリストの全曲を返す',
    { name: z.string().min(1).describe('プレイリスト名') }, READ, ({ name }) => actions.playlist(player, name));
  tool('list_presets', 'プリセット一覧', 'プリセット（お気に入りの局やプレイリスト）を返す。id は play_preset に渡す',
    {}, READ, () => actions.presets(player));
  tool('search', '検索', 'サービス内を検索する。結果は分類（アーティスト・アルバム・曲など）の browseKey を含むことが多いので browse で開く',
    { query: z.string().min(1).describe('検索語'),
      service: z.string().default('LocalMusic').describe('サービス名（LocalMusic・Amazon・TuneIn など。browse のルートの browseKey から末尾の ":" を除いたもの）'),
      limit: z.number().int().min(1).max(500).default(50).describe('返す項目数の上限') },
    READ, ({ query, service, limit }) => actions.search(player, query, { service, limit }));
  tool('browse', 'ブラウズ', '音楽ソースの階層をたどる。key を省くとソースと入力の一覧。'
      + '項目の browseKey で下の階層へ、playURL を play_item で再生、contextMenuKey を item_menu でメニュー取得。nextKey があれば続きがある',
    { key: z.string().optional().describe('browseKey または nextKey'),
      limit: z.number().int().min(1).max(500).default(100).describe('返す項目数の上限') },
    READ, ({ key, limit }) => actions.browse(player, { key, limit }));
  tool('item_menu', '項目のメニュー', 'browse・search の項目の contextMenuKey からメニュー（今すぐ再生・次に追加・最後に追加など）を返す。actionURL を play_item に渡す',
    { contextMenuKey: z.string().min(1) }, READ, ({ contextMenuKey }) => actions.itemMenu(player, contextMenuKey));

  // ── 再生操作（操作後の状態を返す） ──
  tool('play', '再生', '一時停止・停止中の再生を再開する', {}, CONTROL, () => actions.play(player));
  tool('pause', '一時停止', '再生を一時停止する', {}, CONTROL, () => actions.pause(player));
  tool('stop', '停止', '再生を停止する', {}, CONTROL, () => actions.stop(player));
  tool('next', '次へ', '次の曲へ進む（ラジオでは局が対応している場合のみ）', {}, CONTROL, () => actions.next(player));
  tool('previous', '前へ', '前の曲へ戻る（ラジオでは局が対応している場合のみ）', {}, CONTROL, () => actions.previous(player));
  tool('set_volume', '音量', '音量を 0〜100 で設定する。level（絶対値）か delta（増減）のどちらかを指定',
    { level: z.number().min(0).max(100).optional(), delta: z.number().min(-100).max(100).optional() },
    CONTROL, ({ level, delta }) => {
      if ((level === undefined) === (delta === undefined)) throw new Error('level と delta のどちらか一方を指定してください');
      return actions.setVolume(player, { level, delta });
    });
  tool('set_mute', 'ミュート', 'ミュートの入・切', { mute: z.boolean() }, CONTROL, ({ mute }) => actions.setMute(player, mute));
  tool('seek', 'シーク', '再生中の曲の指定位置（秒）へ移動する', { seconds: z.number().min(0) },
    CONTROL, ({ seconds }) => actions.seek(player, seconds));
  tool('set_shuffle', 'シャッフル', 'シャッフルの入・切', { shuffle: z.boolean() }, CONTROL, ({ shuffle }) => actions.setShuffle(player, shuffle));
  tool('set_repeat', 'リピート', 'リピートを all（キュー全体）・one（1 曲）・off にする',
    { mode: z.enum(Object.keys(actions.REPEAT_MODES)) }, CONTROL, ({ mode }) => actions.setRepeat(player, mode));
  tool('play_queue_track', 'キューの曲を再生', 'キューの index 番目の曲を再生する（get_queue の index）',
    { index: z.number().int().min(0) }, CONTROL, ({ index }) => actions.playQueueTrack(player, index));
  tool('play_preset', 'プリセットを再生', 'プリセットを再生する（list_presets の id）',
    { id: z.number().int().min(1) }, CONTROL, ({ id }) => actions.playPreset(player, id));
  tool('play_playlist', 'プレイリストを再生', 'プレイリストを再生、またはキューに追加する。'
      + 'mode: now=今すぐ再生（キューに追加して再生）, shuffle=シャッフル再生, next=次に再生, last=キューの最後に追加',
    { name: z.string().min(1), mode: z.enum(Object.keys(actions.PLAYLIST_MODES)).default('now') },
    CONTROL, ({ name, mode }) => actions.playPlaylist(player, name, mode));
  tool('play_item', '項目を再生', 'browse・search・item_menu で得た playURL・actionURL を実行する。/Play・/Add で始まる URL のみ',
    { url: z.string().min(1) }, CONTROL, ({ url }) => actions.playItem(player, url));

  return server;
}
