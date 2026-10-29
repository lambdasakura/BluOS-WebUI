// コマンドラインからの操作（bin/bluos.js）。プレーヤーへ直接接続する
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPlayer } from './player.js';
import { createMcpServer } from './mcp.js';
import * as actions from './actions.js';

const USAGE = `使い方: bluos [--host <ホスト:ポート>] [--json] <コマンド> [引数]

  status                      再生状態（コマンド省略時も同じ）
  play | pause | stop         再生・一時停止・停止
  next | prev                 次の曲・前の曲
  volume [<数値>|+<数値>|-<数値>]  音量（0〜100）の表示・設定・増減
  mute | unmute               ミュートの入・切
  seek <秒|分:秒>              再生位置を移動
  shuffle on|off              シャッフル
  repeat all|one|off          リピート
  queue [--start N] [--count N]  キューの曲
  play-track <番号>            キューの曲を再生（queue の番号）
  playlists                   プレイリスト一覧
  playlist <名前>              プレイリストの曲
  play-playlist <名前> [--mode now|shuffle|next|last]
                              プレイリストを再生・キューに追加
  presets                     プリセット一覧
  preset <id>                 プリセットを再生
  search <検索語> [--service <名前>]  検索（既定はライブラリ LocalMusic）
  browse [<browseKey>]        ソースの階層をたどる
  menu <contextMenuKey>       項目のメニュー
  play-item <URL>             browse・menu の playURL・actionURL を実行（/Play・/Add のみ）
  mcp                         MCP サーバーとして起動（stdio）

プレーヤーのアドレスは --host か環境変数 BLUOS_HOST で指定する`;

const fmtTime = (sec) => {
  const s = Math.floor(sec ?? 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const STATE_LABEL = { play: '▶ 再生中', stream: '▶ 再生中', pause: '⏸ 一時停止', stop: '⏹ 停止', connecting: '… 接続中' };

function formatStatus(s) {
  const head = [STATE_LABEL[s.state] ?? s.state, s.title ?? '—'].filter(Boolean).join('  ');
  const sub = [s.artist, s.album].filter(Boolean).join(' / ');
  const flags = [
    s.duration ? `${fmtTime(s.position)} / ${fmtTime(s.duration)}` : null,
    `音量 ${s.volume ?? '-'}${s.mute ? '（ミュート）' : ''}`,
    s.shuffle ? 'シャッフル' : null,
    s.repeat && s.repeat !== 'off' ? `リピート: ${s.repeat}` : null,
    s.sleepMinutes ? `スリープ ${s.sleepMinutes} 分` : null,
    s.service, s.quality,
  ].filter(Boolean).join(' · ');
  return [head, sub, flags].filter(Boolean).join('\n');
}

const formatTrack = (t, i) => `${String(t.index ?? i + 1).padStart(4)}  ${t.title ?? ''}${t.artist ? ` — ${t.artist}` : ''}${t.duration ? `  (${fmtTime(t.duration)})` : ''}`;

function formatBrowse(b) {
  const line = (i) => {
    const keys = [i.browseKey && `browseKey=${i.browseKey}`, i.playURL && `playURL=${i.playURL}`,
      i.actionURL && `actionURL=${i.actionURL}`, i.contextMenuKey && `contextMenuKey=${i.contextMenuKey}`].filter(Boolean);
    return [['-', i.text, i.text2 && `(${i.text2})`].filter(Boolean).join(' '), ...keys.map((k) => `    ${k}`)].join('\n');
  };
  const out = [];
  if (b.title) out.push(`# ${b.title}`);
  for (const i of b.items ?? []) out.push(line(i));
  for (const c of b.categories ?? []) out.push(['##', c.title].filter(Boolean).join(' '), ...c.items.map(line));
  if (b.nextKey) out.push(`（続きあり: bluos browse '${b.nextKey}'）`);
  return out.length ? out.join('\n') : '項目がありません';
}

// "1:30" や "90" を秒にする
function parseSeconds(v) {
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(v ?? '');
  if (!m) throw new Error(`位置は秒か 分:秒 で指定してください: ${v}`);
  return Number(m[1] ?? 0) * 60 + Number(m[2]);
}

function parseNumber(v, what) {
  const n = Number(v);
  if (v === undefined || v === '' || !Number.isFinite(n)) throw new Error(`${what}を数値で指定してください: ${v ?? ''}`);
  return n;
}

function onOff(v, what) {
  if (v === 'on') return true;
  if (v === 'off') return false;
  throw new Error(`${what}は on か off で指定してください: ${v ?? ''}`);
}

// 戻り値は終了コード。mcp は待ち受けを続けるので undefined を返す
export async function main(argv, { env = process.env, stdout = process.stdout, stderr = process.stderr, stdin, mcpStdout } = {}) {
  // "-5"（音量を下げる）をオプションと区別するため、負の数は一旦別の形にしてから解析する
  const NEG = '\u0000';
  let parsed;
  try {
    parsed = parseArgs({
      args: argv.map((a) => (/^-\d/.test(a) ? NEG + a : a)),
      allowPositionals: true,
      options: {
        host: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
        start: { type: 'string' }, count: { type: 'string' }, mode: { type: 'string' }, service: { type: 'string' },
      },
    });
  } catch (err) {
    stderr.write(`エラー: ${err.message}\n\n${USAGE}\n`);
    return 2;
  }
  const { values: opts } = parsed;
  const [command = 'status', ...args] = parsed.positionals.map((a) => (a.startsWith(NEG) ? a.slice(1) : a));
  if (opts.help || command === 'help') {
    stdout.write(`${USAGE}\n`);
    return 0;
  }
  const host = opts.host ?? env.BLUOS_HOST;
  if (!host) {
    stderr.write('エラー: プレーヤーのアドレスを --host か環境変数 BLUOS_HOST で指定してください（例: 192.168.1.100:11000）\n');
    return 2;
  }
  const player = createPlayer(host);

  if (command === 'mcp') {
    // stdout は MCP のやり取りに使うので、ここでは何も書かない
    await createMcpServer(player).connect(new StdioServerTransport(stdin, mcpStdout));
    return undefined;
  }

  const commands = {
    status: async () => [await actions.status(player), formatStatus],
    play: async () => [await actions.play(player), formatStatus],
    pause: async () => [await actions.pause(player), formatStatus],
    stop: async () => [await actions.stop(player), formatStatus],
    next: async () => [await actions.next(player), formatStatus],
    prev: async () => [await actions.previous(player), formatStatus],
    volume: async ([v]) => {
      if (v === undefined) return [await actions.status(player), (s) => `音量 ${s.volume}${s.mute ? '（ミュート）' : ''}`];
      const n = parseNumber(v, '音量');
      const s = await actions.setVolume(player, /^[+-]/.test(v) ? { delta: n } : { level: n });
      return [s, () => `音量 ${s.volume}`];
    },
    mute: async () => [await actions.setMute(player, true), formatStatus],
    unmute: async () => [await actions.setMute(player, false), formatStatus],
    seek: async ([v]) => [await actions.seek(player, parseSeconds(v)), formatStatus],
    shuffle: async ([v]) => [await actions.setShuffle(player, onOff(v, 'シャッフル')), formatStatus],
    repeat: async ([v]) => [await actions.setRepeat(player, v), formatStatus],
    queue: async () => {
      const q = await actions.queue(player, {
        start: opts.start === undefined ? 0 : parseNumber(opts.start, '--start '),
        count: opts.count === undefined ? 50 : parseNumber(opts.count, '--count '),
      });
      return [q, () => [`${q.name ?? 'キュー'}（${q.length ?? q.tracks.length} 曲）`, ...q.tracks.map(formatTrack)].join('\n')];
    },
    'play-track': async ([v]) => [await actions.playQueueTrack(player, parseNumber(v, '曲の番号')), formatStatus],
    playlists: async () => [await actions.playlists(player), (l) => (l.length ? l.join('\n') : 'プレイリストがありません')],
    playlist: async ([name]) => {
      if (!name) throw new Error('プレイリスト名を指定してください');
      const p = await actions.playlist(player, name);
      return [p, () => [`${p.name}（${p.tracks.length} 曲）`, ...p.tracks.map(formatTrack)].join('\n')];
    },
    'play-playlist': async ([name]) => {
      if (!name) throw new Error('プレイリスト名を指定してください');
      return [await actions.playPlaylist(player, name, opts.mode ?? 'now'), formatStatus];
    },
    presets: async () => [await actions.presets(player), (l) => (l.length ? l.map((p) => `${String(p.id).padStart(3)}  ${p.name}`).join('\n') : 'プリセットがありません')],
    preset: async ([v]) => [await actions.playPreset(player, parseNumber(v, 'プリセットの番号')), formatStatus],
    search: async (words) => {
      if (!words.length) throw new Error('検索語を指定してください');
      return [await actions.search(player, words.join(' '), { service: opts.service ?? 'LocalMusic' }), formatBrowse];
    },
    browse: async ([key]) => [await actions.browse(player, { key }), formatBrowse],
    menu: async ([key]) => {
      if (!key) throw new Error('contextMenuKey を指定してください');
      return [await actions.itemMenu(player, key), formatBrowse];
    },
    'play-item': async ([url]) => [await actions.playItem(player, url ?? ''), formatStatus],
  };
  const fn = Object.hasOwn(commands, command) ? commands[command] : null;
  if (!fn) {
    stderr.write(`エラー: 不明なコマンド: ${command}\n\n${USAGE}\n`);
    return 2;
  }
  try {
    const [result, format] = await fn(args);
    stdout.write(`${opts.json ? JSON.stringify(result, null, 2) : format(result)}\n`);
    return 0;
  } catch (err) {
    // fetch の接続エラーは "fetch failed" とだけ言うので、原因を添えて言い換える
    const message = err.message === 'fetch failed' ? `${host} に接続できません（${err.cause?.code ?? err.cause?.message}）` : err.message;
    stderr.write(`エラー: ${message}\n`);
    return 1;
  }
}
