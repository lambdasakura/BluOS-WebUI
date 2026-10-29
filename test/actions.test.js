// lib/player.js・lib/actions.js の単体テスト。偽のプレーヤーを相手に、送る URL と返す値を確かめる
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer } from '../lib/player.js';
import * as actions from '../lib/actions.js';
import { startFakePlayer, sendXml } from './fake-player.js';

let fake;
let player;
before(async () => {
  fake = await startFakePlayer();
  player = createPlayer(fake.host);
});
after(() => fake.close());
beforeEach(() => {
  fake.reset();
  fake.routes.set('/Status', sendXml('<status><state>play</state><volume>40</volume></status>'));
});

const ok = sendXml('<ok/>');
const statusOnly = (path) => fake.requests.filter((r) => r !== '/Status' && r !== path);

describe('player', () => {
  test('HTTP エラーは例外にする', async () => {
    await assert.rejects(player.get('/Nope'), /HTTP 404: not found/);
  });

  test('<error> は例外にする（message が無ければ中身を出す）', async () => {
    fake.routes.set('/A', sendXml('<error><message>bad</message></error>'));
    fake.routes.set('/B', sendXml('<error code="3"/>'));
    await assert.rejects(player.get('/A'), /^Error: bad$/);
    await assert.rejects(player.get('/B'), /player error: \{"code":"3"\}/);
  });

  test('XML 宣言は結果に含めない', async () => {
    fake.routes.set('/A', sendXml('<a x="1"/>'));
    assert.deepEqual(await player.get('/A'), { a: { x: '1' } });
  });
});

describe('取得', () => {
  test('status: 項目を読みやすい形にまとめ、無い項目は省く', async () => {
    fake.routes.set('/Status', sendXml(`<status><state>stream</state><title1>T</title1><title2>A</title2><title3>B</title3>
      <service>TuneIn</service><serviceName>TuneIn Radio</serviceName><secs>5</secs><totlen>200</totlen><volume>12</volume>
      <mute>1</mute><shuffle>1</shuffle><repeat>1</repeat><song>3</song><streamFormat>MP3</streamFormat><sleep>15</sleep>
      <streamUrl>TuneIn:s1</streamUrl></status>`));
    assert.deepEqual(await actions.status(player), {
      state: 'stream', title: 'T', artist: 'A', album: 'B', service: 'TuneIn Radio', position: 5, duration: 200,
      volume: 12, mute: true, shuffle: true, repeat: 'one', queueIndex: 3, quality: 'MP3', sleepMinutes: 15, radio: true,
    });
    fake.routes.set('/Status', sendXml('<status><name>N</name><artist>X</artist><album>Y</album><service>S</service><sleep></sleep></status>'));
    assert.deepEqual(await actions.status(player), { title: 'N', artist: 'X', album: 'Y', service: 'S', mute: false, shuffle: false });
    fake.routes.set('/Status', sendXml('<other/>'));
    assert.deepEqual(await actions.status(player), { mute: false, shuffle: false });
  });

  test('queue: 範囲を指定して取得する', async () => {
    fake.routes.set('/Playlist', sendXml('<playlist name="Q" length="9"><song id="2" service="S"><title>T</title><art>A</art><alb>B</alb><time>60</time></song></playlist>'));
    assert.deepEqual(await actions.queue(player, { start: 2, count: 3 }), {
      name: 'Q', length: 9, tracks: [{ index: 2, title: 'T', artist: 'A', album: 'B', duration: 60, service: 'S' }],
    });
    assert.deepEqual(fake.requests, ['/Playlist?start=2&end=4']);
    fake.routes.set('/Playlist', sendXml('<other/>'));
    assert.deepEqual(await actions.queue(player), { tracks: [] });
    assert.equal(fake.requests.at(-1), '/Playlist?start=0&end=49');
  });

  test('playlists: 画像付きの名前も文字列にする', async () => {
    fake.routes.set('/Playlists', sendXml('<playlists><name image="x">A</name><name>B</name><name image="y"/></playlists>'));
    assert.deepEqual(await actions.playlists(player), ['A', 'B', '']);
    fake.routes.set('/Playlists', sendXml('<playlists/>'));
    assert.deepEqual(await actions.playlists(player), []);
  });

  test('playlist: 全曲を返す', async () => {
    fake.routes.set('/Songs', sendXml('<songs><song service="S"><title>T</title><art>A</art><alb>B</alb><time>10</time></song><song/></songs>'));
    assert.deepEqual(await actions.playlist(player, 'P & Q'), {
      name: 'P & Q', tracks: [{ title: 'T', artist: 'A', album: 'B', duration: 10, service: 'S' }, {}],
    });
    assert.deepEqual(fake.requests, ['/Songs?playlist=P%20%26%20Q&offset=0']);
  });

  test('presets', async () => {
    fake.routes.set('/Presets', sendXml('<presets><preset id="1" name="A" url="u"/><preset id="2" name="B"/></presets>'));
    assert.deepEqual(await actions.presets(player), [{ id: 1, name: 'A' }, { id: 2, name: 'B' }]);
    fake.routes.set('/Presets', sendXml('<presets/>'));
    assert.deepEqual(await actions.presets(player), []);
  });

  test('browse: 操作に使う属性だけを残し、limit 件で打ち切る', async () => {
    fake.routes.set('/Browse', sendXml(`<browse serviceName="Lib" searchKey="L:Search" nextKey="n2">
      <item text="A" text2="a" type="link" browseKey="k" image="i"/><item text="B" playURL="/Add?x" contextMenuKey="cm"/>
      <category text="C"><item text="c1" actionURL="/Add?y"/><item text="c2"/></category><category text="D"><item text="d1"/></category></browse>`));
    assert.deepEqual(await actions.browse(player, { key: 'K', limit: 3 }), {
      title: 'Lib', searchKey: 'L:Search', nextKey: 'n2',
      items: [{ text: 'A', text2: 'a', type: 'link', browseKey: 'k' }, { text: 'B', playURL: '/Add?x', contextMenuKey: 'cm' }],
      categories: [{ title: 'C', items: [{ text: 'c1', actionURL: '/Add?y' }] }],
    });
    assert.deepEqual(fake.requests, ['/Browse?key=K']);
    fake.routes.set('/Browse', sendXml('<browse/>'));
    assert.deepEqual(await actions.browse(player), {});
    assert.equal(fake.requests.at(-1), '/Browse');
  });

  test('search: サービスの searchKey で検索する', async () => {
    fake.routes.set('/Browse', (req, res, url) => {
      const key = url.searchParams.get('key');
      if (key === 'Amazon:') return sendXml('<browse searchKey="Amazon:Search"/>')(req, res);
      if (key === 'Radio:') return sendXml('<browse/>')(req, res);
      sendXml('<browse><item text="hit"/></browse>')(req, res);
    });
    assert.deepEqual((await actions.search(player, 'a b', { service: 'Amazon' })).items, [{ text: 'hit' }]);
    assert.deepEqual(fake.requests, ['/Browse?key=Amazon%3A', '/Browse?key=Amazon%3ASearch&q=a+b']);
    await assert.rejects(actions.search(player, 'x', { service: 'Radio' }), /Radio は検索できません/);
    fake.routes.set('/Browse', sendXml('<browse searchKey="LocalMusic:Search"/>'));
    await actions.search(player, 'x');
    assert.equal(fake.requests.at(-2), '/Browse?key=LocalMusic%3A');
  });

  test('itemMenu: contextMenuKey で開く', async () => {
    fake.routes.set('/Browse', sendXml('<browse><item text="Play now" actionURL="/Add?a=1&amp;b=2"/></browse>'));
    assert.deepEqual(await actions.itemMenu(player, 'cm'), { items: [{ text: 'Play now', actionURL: '/Add?a=1&b=2' }] });
  });
});

describe('再生操作', () => {
  // 操作の URL を送ってから、新しい状態を返す
  for (const [name, call, path] of [
    ['play', (p) => actions.play(p), '/Play'],
    ['pause', (p) => actions.pause(p), '/Pause'],
    ['stop', (p) => actions.stop(p), '/Stop'],
    ['mute', (p) => actions.setMute(p, true), '/Volume?mute=1'],
    ['unmute', (p) => actions.setMute(p, false), '/Volume?mute=0'],
    ['seek', (p) => actions.seek(p, 61.9), '/Play?seek=61'],
    ['seek（負の値は 0）', (p) => actions.seek(p, -5), '/Play?seek=0'],
    ['shuffle on', (p) => actions.setShuffle(p, true), '/Shuffle?state=1'],
    ['shuffle off', (p) => actions.setShuffle(p, false), '/Shuffle?state=0'],
    ['repeat all', (p) => actions.setRepeat(p, 'all'), '/Repeat?state=0'],
    ['repeat one', (p) => actions.setRepeat(p, 'one'), '/Repeat?state=1'],
    ['repeat off', (p) => actions.setRepeat(p, 'off'), '/Repeat?state=2'],
    ['キューの曲', (p) => actions.playQueueTrack(p, 4), '/Play?id=4'],
    ['プリセット', (p) => actions.playPreset(p, 2), '/Preset?id=2'],
    ['プレイリスト（既定は now）', (p) => actions.playPlaylist(p, 'A&B'), '/Add?playlist=A%26B&playnow=1&clear=0&shuffle=0'],
    ['プレイリスト shuffle', (p) => actions.playPlaylist(p, 'A', 'shuffle'), '/Add?playlist=A&shuffle=1&playnow=1'],
    ['プレイリスト next', (p) => actions.playPlaylist(p, 'A', 'next'), '/Add?playlist=A&playnow=-1&where=next'],
    ['プレイリスト last', (p) => actions.playPlaylist(p, 'A', 'last'), '/Add?playlist=A&playnow=-1&where=last'],
    ['play_item /Add', (p) => actions.playItem(p, '/Add?playnow=1&file=x'), '/Add?playnow=1&file=x'],
    ['play_item /Play', (p) => actions.playItem(p, '/Play?url=Capture%3Ax'), '/Play?url=Capture%3Ax'],
    ['音量（絶対値）', (p) => actions.setVolume(p, { level: 33.4 }), '/Volume?level=33'],
    ['音量（上限）', (p) => actions.setVolume(p, { level: 150 }), '/Volume?level=100'],
    ['音量（増減）', (p) => actions.setVolume(p, { delta: -5 }), '/Volume?level=35'],
  ]) {
    test(name, async () => {
      const top = path.split('?')[0];
      fake.routes.set(top, ok);
      const s = await call(player);
      assert.ok(fake.requests.includes(path), `${path} が送られていない: ${fake.requests}`);
      assert.deepEqual(statusOnly(path), []);
      assert.equal(s.state, 'play');
    });
  }

  test('音量の増減: 現在値が無ければ 0 から', async () => {
    fake.routes.set('/Status', sendXml('<status/>'));
    fake.routes.set('/Volume', ok);
    await actions.setVolume(player, { delta: -3 });
    await actions.setVolume(player, {});
    assert.deepEqual(fake.requests.filter((r) => r.startsWith('/Volume')), ['/Volume?level=0', '/Volume?level=0']);
  });

  test('不正な repeat・mode は送らずにエラー', async () => {
    assert.throws(() => actions.setRepeat(player, 'x'), /all \/ one \/ off/);
    assert.throws(() => actions.playPlaylist(player, 'A', 'x'), /now \/ shuffle \/ next \/ last/);
    assert.deepEqual(fake.requests, []);
  });

  test('play_item は /Play・/Add 以外を拒否する', async () => {
    for (const url of ['/Clear', '/Delete?name=x', '/Add/../Clear', 'http://evil/Add?x', '/Addx?y']) {
      assert.throws(() => actions.playItem(player, url), /\/Play・\/Add/, url);
    }
    assert.deepEqual(fake.requests, []);
  });

  test('次へ・前へ: 通常は /Skip・/Back', async () => {
    fake.routes.set('/Skip', ok);
    fake.routes.set('/Back', ok);
    await actions.next(player);
    await actions.previous(player);
    assert.deepEqual(fake.requests, ['/Status', '/Skip', '/Status', '/Status', '/Back', '/Status']);
  });

  test('次へ・前へ: ラジオは actions の URL を使い、無ければエラー', async () => {
    fake.routes.set('/Status', sendXml('<status><state>stream</state><streamUrl>R:1</streamUrl><actions><action name="skip" url="/Action?skip=1"/></actions></status>'));
    fake.routes.set('/Action', ok);
    await actions.next(player);
    assert.ok(fake.requests.includes('/Action?skip=1'));
    await assert.rejects(actions.previous(player), /「前へ」を使えません/);
    fake.routes.set('/Status', sendXml('<status><streamUrl>R:1</streamUrl></status>'));
    await assert.rejects(actions.next(player), /「次へ」を使えません/);
  });
});
