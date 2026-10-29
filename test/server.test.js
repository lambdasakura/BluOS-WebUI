// server.js の単体テスト。偽のプレーヤー（XML を返す HTTP サーバー）を相手に中継・変換・ページ送りを確かめる
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer } from '../server.js';
import { startFakePlayer, sendXml, xml } from './fake-player.js';

const SERVER_JS = fileURLToPath(new URL('../server.js', import.meta.url));
let base; // テスト対象サーバーの URL
let playerHost;
let app;
let fake;
let routes;
let requests;

before(async () => {
  fake = await startFakePlayer();
  ({ host: playerHost, routes, requests } = fake);
  app = createServer(playerHost);
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  base = `http://127.0.0.1:${app.address().port}`;
});

after(() => {
  app.closeAllConnections();
  app.close();
  fake.close();
});

beforeEach(() => fake.reset());

// fetch では送れない生のパス（`//` など）を送る
function rawGet(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}/`, { method, path }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('静的配信', () => {
  test('/ は index.html を返す', async () => {
    const r = await fetch(`${base}/`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.match(await r.text(), /<title>BluOS<\/title>/);
  });

  test('拡張子に応じた content-type を返す', async () => {
    const js = await fetch(`${base}/app.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /text\/javascript/);
    const css = await fetch(`${base}/style.css`);
    assert.match(css.headers.get('content-type'), /text\/css/);
    const manifest = await fetch(`${base}/manifest.webmanifest`);
    assert.equal(manifest.headers.get('content-type'), 'application/manifest+json');
  });

  test('存在しないファイルは 404', async () => {
    const r = await fetch(`${base}/nothing.txt`);
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { error: 'not found' });
  });

  test('public/ の外は読めない', async () => {
    for (const path of ['/../server.js', '/%2e%2e/server.js', '/..%2Fserver.js', '/..%2F..%2Fetc%2Fpasswd']) {
      const r = await rawGet(path);
      assert.notEqual(r.status, 200, path);
      assert.doesNotMatch(r.body, /createServer|root:/, path);
    }
  });

  test('".." を含むパスは 400', async () => {
    const r = await rawGet('/a..b');
    assert.equal(r.status, 400);
  });

  test('不正なパーセントエンコードは 400 で、サーバーは落ちない', async () => {
    for (const path of ['/%', '/%E0%A4%A']) {
      assert.equal((await rawGet(path)).status, 400, path);
    }
    assert.equal((await fetch(`${base}/`)).status, 200);
  });

  test('URL として解釈できないパスは 400', async () => {
    assert.equal((await rawGet('//')).status, 400);
    assert.equal((await fetch(`${base}/`)).status, 200);
  });

  test('GET 以外は 405', async () => {
    const r = await fetch(`${base}/`, { method: 'POST' });
    assert.equal(r.status, 405);
  });
});

describe('/api/config', () => {
  test('プレーヤーのアドレスを返す', async () => {
    const r = await fetch(`${base}/api/config`);
    assert.deepEqual(await r.json(), { player: playerHost });
  });
});

describe('/api/d 中継', () => {
  test('許可していない API は 403 で、プレーヤーへ送らない', async () => {
    const r = await fetch(`${base}/api/d/Reboot`);
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { error: 'not allowed: Reboot' });
    assert.equal(requests.length, 0);
  });

  test('クエリ付きのパスをそのまま転送する', async () => {
    routes.set('/Volume', sendXml('<volume>10</volume>'));
    await fetch(`${base}/api/d/Volume?level=10&tell_slaves=1`);
    assert.deepEqual(requests, ['/Volume?level=10&tell_slaves=1']);
  });

  test('XML を JSON に変換する（属性はキー、値は文字列、XML 宣言は除く）', async () => {
    routes.set('/Status', sendXml(
      '<status etag="abc"><volume>25</volume><title1>It&#39;s &amp; Me</title1><song>3</song></status>'));
    const r = await fetch(`${base}/api/d/Status`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await r.json(), { status: { etag: 'abc', volume: '25', title1: "It's & Me", song: '3' } });
  });

  test('content-type が XML でなくても <?xml で始まれば変換する', async () => {
    routes.set('/Presets', sendXml('<presets prid="1"><preset id="1" name="A"/></presets>', 'text/plain'));
    const body = await (await fetch(`${base}/api/d/Presets`)).json();
    assert.deepEqual(body, { presets: { prid: '1', preset: [{ id: '1', name: 'A' }] } });
  });

  test('1 件でも配列にするタグ・パス', async () => {
    routes.set('/Playlist', sendXml('<playlist name="Q" length="1"><song id="0"><title>T</title></song></playlist>'));
    routes.set('/Browse', sendXml('<browse><item text="A"/><category text="C"><item text="B"/></category></browse>'));
    routes.set('/Playlists', sendXml('<playlists><name image="/i">P</name></playlists>'));
    routes.set('/Alarms', sendXml('<alarms><alarm id="1" hour="7"/></alarms>'));
    routes.set('/AddToPlaylistOptions', sendXml(
      '<addToPlaylistOptions urlPath="/AddToPlaylist"><requestParameter>songid=x</requestParameter>' +
      '<playlists service="LocalMusic" create="1"><name>P</name></playlists></addToPlaylistOptions>'));
    routes.set('/library/v1/Folders', sendXml(
      '<folders><subfolders><folder>Rock</folder></subfolders><songs><song fn="/a.flac"/></songs></folders>'));

    const get = async (p) => (await fetch(`${base}/api/d${p}`)).json();
    assert.deepEqual((await get('/Playlist')).playlist.song, [{ id: '0', title: 'T' }]);
    const b = (await get('/Browse')).browse;
    assert.deepEqual(b.item, [{ text: 'A' }]);
    assert.deepEqual(b.category, [{ text: 'C', item: [{ text: 'B' }] }]);
    assert.deepEqual((await get('/Playlists')).playlists.name, [{ '#text': 'P', image: '/i' }]);
    assert.deepEqual((await get('/Alarms')).alarms.alarm, [{ id: '1', hour: '7' }]);
    const o = (await get('/AddToPlaylistOptions')).addToPlaylistOptions;
    assert.deepEqual(o.requestParameter, ['songid=x']);
    assert.deepEqual(o.playlists.name, ['P']);
    const f = (await get('/library/v1/Folders?service=LocalMusic')).folders;
    assert.deepEqual(f.subfolders.folder, ['Rock']);
    assert.deepEqual(f.songs.song, [{ fn: '/a.flac' }]);
  });

  test('/Status の song は単一値のまま（配列にしない）', async () => {
    routes.set('/Status', sendXml('<status><song>5</song><actions><action name="skip" url="/Action?x"/></actions></status>'));
    const { status } = await (await fetch(`${base}/api/d/Status`)).json();
    assert.equal(status.song, '5');
    assert.deepEqual(status.actions.action, [{ name: 'skip', url: '/Action?x' }]);
  });

  test('画像はそのまま返し、キャッシュさせる', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]);
    routes.set('/Artwork', (req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(png);
    });
    const r = await fetch(`${base}/api/d/Artwork?fn=x`);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.equal(r.headers.get('cache-control'), 'max-age=3600');
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), png);
  });

  test('XML 以外の応答はキャッシュさせない。content-type が無ければ octet-stream', async () => {
    routes.set('/Info', (req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>tech</html>');
    });
    routes.set('/Action', (req, res) => res.end('ok')); // content-type なし
    const info = await fetch(`${base}/api/d/Info?category=technical`);
    assert.equal(info.headers.get('cache-control'), 'no-store');
    assert.equal(await info.text(), '<html>tech</html>');
    const action = await fetch(`${base}/api/d/Action?x=1`);
    assert.equal(action.headers.get('content-type'), 'application/octet-stream');
  });

  test('エラー応答のステータスを保つ', async () => {
    routes.set('/Play', (req, res) => {
      res.writeHead(500, { 'content-type': 'text/xml' });
      res.end(xml('<error>bad</error>'));
    });
    const r = await fetch(`${base}/api/d/Play`);
    assert.equal(r.status, 500);
    assert.deepEqual(await r.json(), { error: 'bad' });
  });

  test('/Info のリダイレクトは追従せずブラウザに返す', async () => {
    routes.set('/Info', (req, res) => {
      res.writeHead(302, { location: 'https://www.last.fm/music/X' });
      res.end();
    });
    const r = await fetch(`${base}/api/d/Info?artist=X`, { redirect: 'manual' });
    assert.equal(r.status, 302);
    assert.equal(r.headers.get('location'), 'https://www.last.fm/music/X');
  });

  test('プレーヤーに届かなければ 502', async () => {
    const down = createServer('127.0.0.1:9');
    down.listen(0, '127.0.0.1');
    await once(down, 'listening');
    try {
      const r = await fetch(`http://127.0.0.1:${down.address().port}/api/d/Status`);
      assert.equal(r.status, 502);
      assert.match((await r.json()).error, /^player unreachable: /);
    } finally {
      down.close();
    }
  });

  test('プレーヤーが応答しなければタイムアウトで 502', async () => {
    routes.set('/Status', () => {}); // 応答しない
    const slow = createServer(playerHost, { proxyTimeout: 50 });
    slow.listen(0, '127.0.0.1');
    await once(slow, 'listening');
    try {
      const r = await fetch(`http://127.0.0.1:${slow.address().port}/api/d/Status`);
      assert.equal(r.status, 502);
      assert.deepEqual(await r.json(), { error: 'player unreachable: timeout' });
    } finally {
      slow.close();
    }
  });

  test('ブラウザが接続を切ったらプレーヤーへの要求も止める', async () => {
    let upstreamClosed;
    const closed = new Promise((r) => (upstreamClosed = r));
    routes.set('/Status', (req, res) => {
      res.on('close', upstreamClosed); // long polling 中のまま応答しない
    });
    const ac = new AbortController();
    const pending = fetch(`${base}/api/d/Status?timeout=90`, { signal: ac.signal }).catch((e) => e);
    while (!requests.length) await new Promise((r) => setTimeout(r, 10));
    ac.abort();
    assert.equal((await pending).name, 'AbortError');
    await closed; // 中継側が上流の接続を閉じた
  });
});

describe('/api/playlist-songs', () => {
  const songs = (from, n) => Array.from({ length: n }, (_, i) => `<song songid="s${from + i}"><title>T${from + i}</title></song>`).join('');

  test('offset をたどって全曲を返す', async () => {
    routes.set('/Songs', (req, res, url) => {
      const offset = Number(url.searchParams.get('offset'));
      sendXml(`<songs>${songs(offset, offset < 20 ? 10 : 3)}</songs>`)(req, res);
    });
    const body = await (await fetch(`${base}/api/playlist-songs?playlist=${encodeURIComponent('A & B')}`)).json();
    assert.equal(body.playlist, 'A & B');
    assert.equal(body.songs.length, 23);
    assert.equal(body.songs[22].title, 'T22');
    assert.deepEqual(requests, [0, 10, 20].map((o) => `/Songs?playlist=A%20%26%20B&offset=${o}`));
  });

  test('空のプレイリスト', async () => {
    routes.set('/Songs', sendXml('<songs/>'));
    const body = await (await fetch(`${base}/api/playlist-songs?playlist=X`)).json();
    assert.deepEqual(body.songs, []);
  });

  test('playlist が無ければ 400', async () => {
    assert.equal((await fetch(`${base}/api/playlist-songs`)).status, 400);
  });

  test('取得に失敗したら 502', async () => {
    routes.set('/Songs', (req, res) => req.socket.destroy());
    const r = await fetch(`${base}/api/playlist-songs?playlist=X`);
    assert.equal(r.status, 502);
  });
});

describe('/api/browse', () => {
  test('nextKey をたどって item と category をまとめる', async () => {
    routes.set('/Browse', (req, res, url) => {
      const key = url.searchParams.get('key');
      if (key === 'root') {
        return sendXml('<browse nextKey="p2" searchKey="s"><item text="A"/><category text="C1"><item text="c1"/></category></browse>')(req, res);
      }
      if (key === 'p2') {
        return sendXml('<browse nextKey="p3"><item text="B"/><category text="C1"><item text="c2"/></category><category text="C2"/></browse>')(req, res);
      }
      return sendXml('<browse><category text="C2"><item text="c3"/></category></browse>')(req, res); // item の無いページ
    });
    const { browse } = await (await fetch(`${base}/api/browse?key=root`)).json();
    assert.deepEqual(browse.item.map((i) => i.text), ['A', 'B']);
    assert.deepEqual(browse.category, [{ text: 'C1', item: [{ text: 'c1' }, { text: 'c2' }] }, { text: 'C2', item: [{ text: 'c3' }] }]);
    assert.equal(browse.searchKey, 's');
    assert.equal(browse.nextKey, undefined);
  });

  test('検索語を q で渡す。キーが無ければルート', async () => {
    routes.set('/Browse', sendXml('<browse/>'));
    await fetch(`${base}/api/browse?key=${encodeURIComponent('Svc:search')}&q=${encodeURIComponent('a b')}`);
    await fetch(`${base}/api/browse`);
    assert.deepEqual(requests, ['/Browse?key=Svc%3Asearch&q=a+b', '/Browse']);
  });

  test('同じ nextKey が続いたら止める', async () => {
    routes.set('/Browse', sendXml('<browse nextKey="same"><item text="A"/></browse>'));
    const { browse } = await (await fetch(`${base}/api/browse?key=same`)).json();
    assert.equal(browse.item.length, 2);
    assert.equal(browse.nextKey, undefined);
  });

  test('2000 件を超えたら残りの nextKey を付けて返す', async () => {
    const page = Array.from({ length: 500 }, (_, i) => `<item text="i${i}"/>`).join('');
    let n = 0;
    routes.set('/Browse', (req, res) => sendXml(`<browse nextKey="k${++n}">${page}</browse>`)(req, res));
    const { browse } = await (await fetch(`${base}/api/browse?key=k0`)).json();
    assert.equal(browse.item.length, 2000);
    assert.equal(browse.nextKey, 'k4');
  });

  test('プレーヤーがエラーを返したら 502', async () => {
    routes.set('/Browse', sendXml('<error><message>no such key</message></error>'));
    const r = await fetch(`${base}/api/browse?key=bad`);
    assert.equal(r.status, 502);
    assert.match((await r.json()).error, /no such key/);
  });

  test('メッセージの無いエラー', async () => {
    routes.set('/Browse', sendXml('<error code="1"/>'));
    const r = await fetch(`${base}/api/browse?key=bad`);
    assert.match((await r.json()).error, /player error/);
  });

  test('一覧が無い応答は空として返す', async () => {
    routes.set('/Browse', sendXml('<other/>'));
    const { browse } = await (await fetch(`${base}/api/browse?key=x`)).json();
    assert.deepEqual(browse, { item: [], category: [] });
  });
});

describe('/mcp', () => {
  test('MCP クライアントからツールを呼べる', async () => {
    routes.set('/Status', sendXml('<status><state>play</state><title1>T</title1><volume>30</volume></status>'));
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === 'get_status'));
    const r = await client.callTool({ name: 'get_status', arguments: {} });
    assert.deepEqual(JSON.parse(r.content[0].text), { state: 'play', title: 'T', volume: 30, mute: false, shuffle: false });
    await client.close();
  });

  test('POST 以外は 405', async () => {
    assert.equal((await fetch(`${base}/mcp`)).status, 405);
  });

  test('他のサイトの Origin からは 403。同じホストの Origin は受け付ける', async () => {
    const post = (origin) => fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });
    assert.equal((await post('http://evil.example')).status, 403);
    assert.equal((await post('null')).status, 403);
    const same = await post(base);
    assert.equal(same.status, 200);
    assert.deepEqual((await same.json()).result, {});
  });
});

describe('起動', () => {
  // env の値が undefined の変数は渡さない
  const run = (env) => {
    const merged = { ...process.env, ...env };
    for (const [k, v] of Object.entries(merged)) if (v === undefined) delete merged[k];
    const child = spawn(process.execPath, [SERVER_JS], { env: merged });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    return { child, output: () => out };
  };

  test('BLUOS_HOST が無ければエラー終了する', async () => {
    const { child, output } = run({ BLUOS_HOST: '' });
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
    assert.match(output(), /BLUOS_HOST/);
  });

  test('起動して待ち受け、SIGTERM で終了する', async () => {
    const { child, output } = run({ BLUOS_HOST: playerHost, PORT: '0', LISTEN: undefined }); // LISTEN は既定（0.0.0.0）
    while (!output().includes('BluOS Web UI:')) {
      if (child.exitCode != null) assert.fail(output());
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.match(output(), new RegExp(`player: ${playerHost}`));
    child.kill('SIGTERM');
    const [code] = await once(child, 'exit');
    assert.equal(code, 0);
    assert.match(output(), /SIGTERM を受け取ったので終了します/);
  });
});
