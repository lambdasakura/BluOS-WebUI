// lib/mcp.js の単体テスト。MCP クライアントからツールを呼び、プレーヤーへ送る URL と結果を確かめる
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPlayer } from '../lib/player.js';
import { createMcpServer } from '../lib/mcp.js';
import { startFakePlayer, sendXml } from './fake-player.js';

let fake;
let client;
before(async () => {
  fake = await startFakePlayer();
  const server = createMcpServer(createPlayer(fake.host));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
});
after(async () => {
  await client.close();
  fake.close();
});
beforeEach(() => {
  fake.reset();
  fake.routes.set('/Status', sendXml('<status><state>play</state><volume>40</volume></status>'));
  for (const p of ['/Play', '/Pause', '/Stop', '/Skip', '/Back', '/Volume', '/Shuffle', '/Repeat', '/Preset', '/Add']) {
    fake.routes.set(p, sendXml('<ok/>'));
  }
  fake.routes.set('/Playlist', sendXml('<playlist name="Q" length="1"><song id="0"><title>T</title></song></playlist>'));
  fake.routes.set('/Playlists', sendXml('<playlists><name>A</name></playlists>'));
  fake.routes.set('/Songs', sendXml('<songs><song><title>S</title></song></songs>'));
  fake.routes.set('/Presets', sendXml('<presets><preset id="1" name="P"/></presets>'));
  fake.routes.set('/Browse', (req, res, url) => sendXml(url.searchParams.get('key') === 'LocalMusic:'
    ? '<browse searchKey="LocalMusic:Search"/>'
    : '<browse><item text="X" playURL="/Add?x=1"/></browse>')(req, res));
});

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  return { error: r.isError ?? false, text: r.content[0].text };
};
const sent = () => fake.requests.filter((r) => r !== '/Status');

test('ツールの一覧と注釈（取得系は読み取りのみ、操作系は破壊的でない）', async () => {
  const { tools } = await client.listTools();
  assert.equal(tools.length, 22);
  for (const t of tools) {
    assert.ok(t.description, t.name);
    assert.equal(t.annotations.destructiveHint ?? false, false, t.name);
  }
  const readOnly = tools.filter((t) => t.annotations.readOnlyHint).map((t) => t.name);
  assert.deepEqual(readOnly, ['get_status', 'get_queue', 'list_playlists', 'get_playlist', 'list_presets', 'search', 'browse', 'item_menu']);
});

test('サーバーの説明に使い方を含める', () => {
  assert.match(client.getInstructions(), /play_item/);
});

describe('取得', () => {
  for (const [name, args, path, expect] of [
    ['get_status', {}, null, { state: 'play', volume: 40, mute: false, shuffle: false }],
    ['get_queue', { start: 0, count: 1 }, '/Playlist?start=0&end=0', { name: 'Q', length: 1, tracks: [{ index: 0, title: 'T' }] }],
    ['list_playlists', {}, '/Playlists', ['A']],
    ['get_playlist', { name: 'A' }, '/Songs?playlist=A&offset=0', { name: 'A', tracks: [{ title: 'S' }] }],
    ['list_presets', {}, '/Presets', [{ id: 1, name: 'P' }]],
    ['search', { query: 'q' }, '/Browse?key=LocalMusic%3ASearch&q=q', { items: [{ text: 'X', playURL: '/Add?x=1' }] }],
    ['browse', {}, '/Browse', { items: [{ text: 'X', playURL: '/Add?x=1' }] }],
    ['item_menu', { contextMenuKey: 'cm' }, '/Browse?key=cm', { items: [{ text: 'X', playURL: '/Add?x=1' }] }],
  ]) {
    test(name, async () => {
      const r = await call(name, args);
      assert.equal(r.error, false, r.text);
      assert.deepEqual(JSON.parse(r.text), expect);
      if (path) assert.ok(fake.requests.includes(path), `${path} が送られていない: ${fake.requests}`);
    });
  }
});

describe('再生操作', () => {
  for (const [name, args, path] of [
    ['play', {}, '/Play'],
    ['pause', {}, '/Pause'],
    ['stop', {}, '/Stop'],
    ['next', {}, '/Skip'],
    ['previous', {}, '/Back'],
    ['set_volume', { level: 20 }, '/Volume?level=20'],
    ['set_volume', { delta: 5 }, '/Volume?level=45'],
    ['set_mute', { mute: true }, '/Volume?mute=1'],
    ['seek', { seconds: 30 }, '/Play?seek=30'],
    ['set_shuffle', { shuffle: false }, '/Shuffle?state=0'],
    ['set_repeat', { mode: 'all' }, '/Repeat?state=0'],
    ['play_queue_track', { index: 3 }, '/Play?id=3'],
    ['play_preset', { id: 1 }, '/Preset?id=1'],
    ['play_playlist', { name: 'A' }, '/Add?playlist=A&playnow=1&clear=0&shuffle=0'],
    ['play_playlist', { name: 'A', mode: 'last' }, '/Add?playlist=A&playnow=-1&where=last'],
    ['play_item', { url: '/Add?x=1' }, '/Add?x=1'],
  ]) {
    test(`${name} ${JSON.stringify(args)}`, async () => {
      const r = await call(name, args);
      assert.equal(r.error, false, r.text);
      assert.deepEqual(sent(), [path]);
      assert.equal(JSON.parse(r.text).state, 'play'); // 操作後の状態を返す
    });
  }
});

describe('エラー', () => {
  test('set_volume は level と delta のどちらか一方だけ', async () => {
    for (const args of [{}, { level: 1, delta: 1 }]) {
      const r = await call('set_volume', args);
      assert.equal(r.error, true);
      assert.match(r.text, /どちらか一方/);
    }
    assert.deepEqual(sent(), []);
  });

  test('許可していない URL は play_item で実行しない', async () => {
    const r = await call('play_item', { url: '/Clear' });
    assert.equal(r.error, true);
    assert.deepEqual(sent(), []);
  });

  test('プレーヤーのエラーをツールのエラーとして返す', async () => {
    fake.routes.set('/Playlists', sendXml('<error><message>busy</message></error>'));
    assert.deepEqual(await call('list_playlists'), { error: true, text: 'エラー: busy' });
  });

  test('引数の検証に失敗したらツールのエラー', async () => {
    const r = await call('set_repeat', { mode: 'sometimes' });
    assert.equal(r.error, true);
    assert.deepEqual(sent(), []);
  });
});
