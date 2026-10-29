// lib/cli.js・bin/bluos.js の単体テスト。偽のプレーヤーを相手にコマンドの出力と送る URL を確かめる
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { main } from '../lib/cli.js';
import { startFakePlayer, sendXml } from './fake-player.js';

const BIN = fileURLToPath(new URL('../bin/bluos.js', import.meta.url));
const SKILL_DIR = fileURLToPath(new URL('../.claude/skills/bluos/', import.meta.url));

let fake;
before(async () => (fake = await startFakePlayer()));
after(() => fake.close());

const STATUS = `<status><state>play</state><title1>Song</title1><artist>Art</artist><album>Alb</album>
  <serviceName>Library</serviceName><secs>65</secs><totlen>200</totlen><volume>40</volume><mute>1</mute>
  <shuffle>1</shuffle><repeat>0</repeat><sleep>30</sleep><streamFormat>FLAC</streamFormat></status>`;

beforeEach(() => {
  fake.reset();
  fake.routes.set('/Status', sendXml(STATUS));
  for (const p of ['/Play', '/Pause', '/Stop', '/Skip', '/Back', '/Volume', '/Shuffle', '/Repeat', '/Preset', '/Add']) {
    fake.routes.set(p, sendXml('<ok/>'));
  }
});

// main を実行し、終了コードと出力を返す
async function cli(...argv) {
  let out = '';
  let err = '';
  const code = await main(argv, {
    env: { BLUOS_HOST: fake.host },
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
  });
  return { code, out, err };
}
const sent = () => fake.requests.filter((r) => r !== '/Status');

describe('引数', () => {
  test('--help と help は使い方を表示する', async () => {
    for (const a of ['--help', '-h', 'help']) {
      const r = await cli(a);
      assert.equal(r.code, 0);
      assert.match(r.out, /^使い方: bluos/);
    }
  });

  test('プレーヤーのアドレスが無ければエラー', async () => {
    let err = '';
    const code = await main(['status'], { env: {}, stderr: { write: (s) => (err += s) } });
    assert.equal(code, 2);
    assert.match(err, /BLUOS_HOST/);
  });

  test('--host は環境変数より優先し、繋がらなければ原因を表示する', async () => {
    // 閉じたばかりのポート（接続を拒否される）
    const closed = http.createServer().listen(0, '127.0.0.1');
    await once(closed, 'listening');
    const host = `127.0.0.1:${closed.address().port}`;
    closed.close();
    const r = await cli('--host', host, 'status');
    assert.equal(r.code, 1);
    assert.equal(r.err, `エラー: ${host} に接続できません（ECONNREFUSED）\n`);
    // fetch が拒否するポート（コードの無い原因）
    assert.equal((await cli('--host', '127.0.0.1:9', 'status')).err, 'エラー: 127.0.0.1:9 に接続できません（bad port）\n');
  });

  test('不明なコマンド・オプションは使い方を表示して終了コード 2', async () => {
    for (const argv of [['bogus'], ['--bogus'], ['toString']]) {
      const r = await cli(...argv);
      assert.equal(r.code, 2, argv.join(' '));
      assert.match(r.err, /使い方/);
    }
  });

  test('プレーヤーのエラーは終了コード 1', async () => {
    fake.routes.set('/Playlists', sendXml('<error><message>busy</message></error>'));
    assert.deepEqual(await cli('playlists'), { code: 1, out: '', err: 'エラー: busy\n' });
  });
});

describe('状態と再生操作', () => {
  test('status（コマンド省略時も同じ）', async () => {
    const expected = '▶ 再生中  Song\nArt / Alb\n1:05 / 3:20 · 音量 40（ミュート） · シャッフル · リピート: all · スリープ 30 分 · Library · FLAC\n';
    assert.deepEqual(await cli('status'), { code: 0, out: expected, err: '' });
    assert.equal((await cli()).out, expected);
  });

  test('status: 項目の少ない状態', async () => {
    fake.routes.set('/Status', sendXml('<status><state>weird</state><repeat>2</repeat></status>'));
    assert.equal((await cli('status')).out, 'weird  —\n音量 -\n');
    fake.routes.set('/Status', sendXml('<status/>'));
    assert.equal((await cli('status')).out, '—\n音量 -\n'); // 状態の無い応答
  });

  test('--json は JSON で出力する', async () => {
    const r = await cli('--json', 'status');
    assert.equal(JSON.parse(r.out).title, 'Song');
  });

  for (const [argv, path] of [
    [['play'], '/Play'], [['pause'], '/Pause'], [['stop'], '/Stop'], [['next'], '/Skip'], [['prev'], '/Back'],
    [['mute'], '/Volume?mute=1'], [['unmute'], '/Volume?mute=0'],
    [['seek', '1:30'], '/Play?seek=90'], [['seek', '45'], '/Play?seek=45'],
    [['shuffle', 'on'], '/Shuffle?state=1'], [['shuffle', 'off'], '/Shuffle?state=0'],
    [['repeat', 'one'], '/Repeat?state=1'],
    [['play-track', '3'], '/Play?id=3'], [['preset', '2'], '/Preset?id=2'],
    [['play-playlist', 'A B'], '/Add?playlist=A%20B&playnow=1&clear=0&shuffle=0'],
    [['play-playlist', 'A', '--mode', 'next'], '/Add?playlist=A&playnow=-1&where=next'],
    [['play-item', '/Add?x=1'], '/Add?x=1'],
  ]) {
    test(argv.join(' '), async () => {
      const r = await cli(...argv);
      assert.equal(r.code, 0, r.err);
      assert.deepEqual(sent(), [path]);
      assert.match(r.out, /^▶ 再生中  Song/);
    });
  }

  test('volume: 表示・設定・増減（負の数も受け付ける）', async () => {
    assert.equal((await cli('volume')).out, '音量 40（ミュート）\n');
    fake.routes.set('/Status', sendXml('<status><volume>40</volume></status>'));
    assert.equal((await cli('volume')).out, '音量 40\n');
    assert.equal((await cli('volume', '25')).out, '音量 40\n'); // 表示は操作後の状態
    await cli('volume', '+5');
    await cli('volume', '-10');
    assert.deepEqual(sent(), ['/Volume?level=25', '/Volume?level=45', '/Volume?level=30']);
  });

  test('引数の誤りは送らずにエラー', async () => {
    for (const [argv, message] of [
      [['volume', 'loud'], /音量を数値で/],
      [['seek'], /秒か 分:秒/],
      [['seek', '1:xx'], /秒か 分:秒/],
      [['shuffle', 'maybe'], /on か off/],
      [['shuffle'], /on か off/],
      [['repeat', 'x'], /all \/ one \/ off/],
      [['play-track'], /曲の番号を数値で/],
      [['play-track', ''], /曲の番号を数値で/],
      [['preset', 'x'], /プリセットの番号を数値で/],
      [['play-playlist'], /プレイリスト名を指定/],
      [['play-playlist', 'A', '--mode', 'x'], /now \/ shuffle/],
      [['play-item'], /\/Play・\/Add/],
      [['play-item', '/Clear'], /\/Play・\/Add/],
      [['queue', '--count', 'x'], /--count を数値で/],
    ]) {
      const r = await cli(...argv);
      assert.equal(r.code, 1, argv.join(' '));
      assert.match(r.err, message, argv.join(' '));
    }
    assert.deepEqual(sent(), []);
  });
});

describe('一覧', () => {
  test('queue', async () => {
    fake.routes.set('/Playlist', sendXml(`<playlist name="Q" length="20">
      <song id="5"><title>T</title><art>A</art><time>61</time></song><song id="6"><title>U</title></song></playlist>`));
    assert.equal((await cli('queue', '--start', '5', '--count', '2')).out, 'Q（20 曲）\n   5  T — A  (1:01)\n   6  U\n');
    assert.deepEqual(sent(), ['/Playlist?start=5&end=6']);
    fake.routes.set('/Playlist', sendXml('<playlist/>'));
    assert.equal((await cli('queue')).out, 'キュー（0 曲）\n');
  });

  test('playlists・playlist', async () => {
    fake.routes.set('/Playlists', sendXml('<playlists><name>A</name><name>B</name></playlists>'));
    assert.equal((await cli('playlists')).out, 'A\nB\n');
    fake.routes.set('/Playlists', sendXml('<playlists/>'));
    assert.equal((await cli('playlists')).out, 'プレイリストがありません\n');
    fake.routes.set('/Songs', sendXml('<songs><song><title>S</title></song><song/></songs>'));
    assert.equal((await cli('playlist', 'A')).out, 'A（2 曲）\n   1  S\n   2  \n');
    assert.match((await cli('playlist')).err, /プレイリスト名を指定/);
  });

  test('presets', async () => {
    fake.routes.set('/Presets', sendXml('<presets><preset id="1" name="Radio"/></presets>'));
    assert.equal((await cli('presets')).out, '  1  Radio\n');
    fake.routes.set('/Presets', sendXml('<presets/>'));
    assert.equal((await cli('presets')).out, 'プリセットがありません\n');
  });

  test('search・browse・menu: 項目と操作に使うキーを表示する', async () => {
    fake.routes.set('/Browse', (req, res, url) => {
      const key = url.searchParams.get('key');
      if (key === 'Amazon:') return sendXml('<browse searchKey="Amazon:Search"/>')(req, res);
      if (key === 'empty') return sendXml('<browse/>')(req, res);
      sendXml(`<browse serviceName="Svc"><item text="A" text2="a" browseKey="k" contextMenuKey="cm"/>
        <category text="Songs"><item text="S" playURL="/Add?s=1"/><item actionURL="/Add?t=1"/></category><category><item text="X"/></category></browse>`)(req, res);
    });
    const expected = `# Svc
- A (a)
    browseKey=k
    contextMenuKey=cm
## Songs
- S
    playURL=/Add?s=1
-
    actionURL=/Add?t=1
##
- X
`;
    assert.equal((await cli('search', 'a', 'b', '--service', 'Amazon')).out, expected);
    assert.ok(fake.requests.includes('/Browse?key=Amazon%3ASearch&q=a+b'));
    assert.equal((await cli('browse', 'k')).out, expected);
    assert.equal((await cli('menu', 'cm')).out, expected);
    assert.equal((await cli('browse', 'empty')).out, '項目がありません\n');
    assert.match((await cli('search')).err, /検索語を指定/);
    assert.match((await cli('menu')).err, /contextMenuKey を指定/);
  });

  test('browse: 100 件を超える分は続きのキーを表示する', async () => {
    const page = Array.from({ length: 60 }, (_, i) => `<item text="i${i}"/>`).join('');
    let n = 0;
    fake.routes.set('/Browse', (req, res) => sendXml(`<browse nextKey="k${++n}">${page}</browse>`)(req, res));
    const r = await cli('browse', 'k0');
    assert.equal(r.out.split('\n').filter((l) => l.startsWith('- ')).length, 100);
    assert.match(r.out, /（続きあり: bluos browse 'k2'）\n$/);
  });

  test('search はサービスを省くとライブラリ', async () => {
    fake.routes.set('/Browse', sendXml('<browse searchKey="LocalMusic:Search"/>'));
    await cli('search', 'x');
    assert.deepEqual(fake.requests, ['/Browse?key=LocalMusic%3A', '/Browse?key=LocalMusic%3ASearch&q=x']);
  });
});

describe('mcp', () => {
  test('stdio で MCP のリクエストに応答する', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const code = await main(['mcp'], { env: { BLUOS_HOST: fake.host }, stdin, mcpStdout: stdout });
    assert.equal(code, undefined); // 待ち受けを続ける
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);
    const [line] = await once(stdout, 'data');
    const { result } = JSON.parse(line.toString());
    assert.ok(result.tools.some((t) => t.name === 'get_status'));
    stdin.end();
  });
});

describe('bin/bluos.js', () => {
  const run = async (...argv) => {
    const child = spawn(process.execPath, [BIN, ...argv], { env: { ...process.env, BLUOS_HOST: fake.host } });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    const [code] = await once(child, 'exit');
    return { code, out };
  };

  test('終了コードと出力', async () => {
    assert.deepEqual(await run('volume'), { code: 0, out: '音量 40（ミュート）\n' });
    assert.equal((await run('bogus')).code, 2);
  });
});

describe('agent skill（.claude/skills/bluos）', () => {
  test('scripts/bluos から CLI を呼べる', async () => {
    const child = spawn(`${SKILL_DIR}scripts/bluos`, ['volume'], { env: { ...process.env, BLUOS_HOST: fake.host } });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    const [code] = await once(child, 'exit');
    assert.deepEqual({ code, out }, { code: 0, out: '音量 40（ミュート）\n' });
  });

  test('SKILL.md に載せたコマンドはすべて CLI にある', async () => {
    const skill = await readFile(`${SKILL_DIR}SKILL.md`, 'utf8');
    assert.match(skill, /^---\nname: bluos\ndescription: .+\n---\n/);
    const usage = (await cli('--help')).out;
    const commands = new Set([...skill.matchAll(/^bluos (?:--json )?([a-z-]+)/gm)].flatMap(([, c]) => c));
    assert.ok(commands.size > 15);
    for (const c of commands) assert.match(usage, new RegExp(`^  (\\S+ \\| )*${c}\\b`, 'm'), c);
  });
});
