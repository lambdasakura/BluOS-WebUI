// BluOS プレーヤー用の Web UI サーバー。
// - public/ 配下の静的ファイルを配信
// - /api/d/<BluOS パス> をプレーヤーへ中継し、XML 応答は JSON に変換して返す
// - /mcp で MCP サーバー（Streamable HTTP）を提供する
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createPlayer, parser } from './lib/player.js';
import { createMcpServer } from './lib/mcp.js';

const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));

// 中継を許可する BluOS API（先頭のパス要素）。再起動・設定変更系は含めない。
const ALLOWED = new Set([
  'Status', 'SyncStatus', 'Play', 'Pause', 'Stop', 'Skip', 'Back',
  'Volume', 'Shuffle', 'Repeat', 'Playlist', 'Clear', 'Delete', 'Move', 'Save',
  'Presets', 'Preset', 'SetPreset', 'RemovePreset',
  'Browse', 'RadioBrowse', 'Add', 'Songs', 'Playlists', 'Sleep', 'Alarms',
  'Reindex', // ライブラリの再スキャン（公式ドキュメント外）
  'Action', // ストリーミングラジオの skip / back / love / ban（/Status の actions が URL を示す）
  'AddFavourite', 'DeleteFavourite', 'AddToPlaylistOptions', 'AddToPlaylist',
  'Info', // 曲情報（外部サイトへのリダイレクト）・技術情報（HTML）
  'Artwork', 'images', 'Sources',
  'library', // /library/v1/Folders などライブラリ参照（読み取りのみ）
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function proxy(player, res, devicePath, timeoutMs) {
  const top = devicePath.split(/[/?]/)[1];
  if (!ALLOWED.has(top)) return sendJson(res, 403, { error: `not allowed: ${top}` });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  res.on('close', () => controller.abort());

  try {
    // Info は last.fm などへのリダイレクトを返すので、追従せずブラウザに渡す
    const redirect = top === 'Info' ? 'manual' : 'follow';
    const upstream = await fetch(`http://${player}${devicePath}`, { signal: controller.signal, redirect });
    const location = upstream.headers.get('location');
    if (redirect === 'manual' && location) {
      res.writeHead(upstream.status, { location, 'cache-control': 'no-store' });
      return res.end();
    }
    const type = upstream.headers.get('content-type') ?? '';
    const body = Buffer.from(await upstream.arrayBuffer());

    if (type.includes('xml') || body.subarray(0, 5).toString() === '<?xml') {
      const parsed = parser.parse(body.toString('utf8'));
      delete parsed['?xml'];
      return sendJson(res, upstream.status, parsed);
    }
    res.writeHead(upstream.status, {
      'content-type': type || 'application/octet-stream',
      'cache-control': top === 'Artwork' || top === 'images' || top === 'Sources' ? 'max-age=3600' : 'no-store',
    });
    res.end(body);
  } catch (err) {
    if (res.writableEnded || res.destroyed) return;
    sendJson(res, 502, { error: `player unreachable: ${err.name === 'AbortError' ? 'timeout' : err.message}` });
  } finally {
    clearTimeout(timer);
  }
}

async function serveStatic(res, pathname) {
  let rel;
  try {
    rel = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname));
  } catch {
    return sendJson(res, 400, { error: 'bad path' }); // 不正なパーセントエンコード
  }
  if (rel.includes('..')) return sendJson(res, 400, { error: 'bad path' });
  try {
    const data = await readFile(join(PUBLIC_DIR, rel));
    res.writeHead(200, { 'content-type': MIME[extname(rel)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

// プレイリストの全曲。/Songs は 1 回に 10 曲しか返さないので、サーバー側で全ページをまとめて返す
// （ブラウザから 10 曲ずつ取ると、同時接続数の制限で画像読み込みの後ろに並んで遅くなる）
async function playlistSongs(client, res, name) {
  if (!name) return sendJson(res, 400, { error: 'playlist is required' });
  try {
    sendJson(res, 200, { playlist: name, songs: await client.playlistSongs(name) });
  } catch (err) {
    sendJson(res, 502, { error: `player unreachable: ${err.message}` });
  }
}

// Browse の nextKey をたどり、BROWSE_MAX 件までまとめて返す（残りがあれば nextKey を付けたまま返す）
async function browseAll(client, res, key, q) {
  try {
    sendJson(res, 200, { browse: await client.browseAll(key, q) });
  } catch (err) {
    sendJson(res, 502, { error: `player unreachable: ${err.message}` });
  }
}

// MCP（Streamable HTTP）。リクエストごとにサーバーを作るステートレス方式で、POST だけを受ける
async function mcp(client, req, res) {
  // 他のサイトのページからブラウザ経由で呼ばれるのを防ぐ（MCP クライアントは Origin を送らない）
  const origin = req.headers.origin;
  if (origin && URL.parse(origin)?.host !== req.headers.host) return sendJson(res, 403, { error: 'forbidden origin' });
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
  const server = createMcpServer(client);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => server.close());
  await server.connect(transport);
  await transport.handleRequest(req, res);
}

// player: 操作するプレーヤーのホスト:ポート
// proxyTimeout: 中継のタイムアウト。/Status の long polling（timeout=最大 100 秒程度）に合わせて余裕を持たせる
export function createServer(player, { proxyTimeout = 130_000 } = {}) {
  const client = createPlayer(player);
  const server = http.createServer(async (req, res) => {
    // 想定外の例外でプロセスごと落ちないよう、リクエスト単位で受け止める
    try {
      await handle(player, client, proxyTimeout, req, res);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      else res.destroy();
    }
  });
  server.requestTimeout = 0; // /Status の long polling を切らない
  return server;
}

async function handle(player, client, proxyTimeout, req, res) {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch {
    return sendJson(res, 400, { error: 'bad request' }); // `//` など URL として解釈できないパス
  }
  if (url.pathname === '/mcp') return mcp(client, req, res);
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
  if (url.pathname.startsWith('/api/d/')) {
    return proxy(player, res, url.pathname.slice('/api/d'.length) + url.search, proxyTimeout);
  }
  if (url.pathname === '/api/config') return sendJson(res, 200, { player });
  if (url.pathname === '/api/playlist-songs') return playlistSongs(client, res, url.searchParams.get('playlist'));
  if (url.pathname === '/api/browse') return browseAll(client, res, url.searchParams.get('key'), url.searchParams.get('q'));
  return serveStatic(res, url.pathname);
}

// 直接実行した時だけ起動する（テストでは createServer を import して使う）
if (import.meta.main) {
  const player = process.env.BLUOS_HOST;
  if (!player) {
    console.error('環境変数 BLUOS_HOST にプレーヤーのアドレス（例: 192.168.1.100:11000）を指定してください');
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.LISTEN ?? '0.0.0.0';
  const server = createServer(player);
  server.listen(port, host, () => {
    console.log(`BluOS Web UI: http://localhost:${port}  (player: ${player})`);
  });

  // コンテナ（PID 1）では既定で SIGTERM を無視するため明示的に終了する。
  // long polling の接続が残っていても待たずに抜ける
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      console.log(`${sig} を受け取ったので終了します`);
      server.close();
      process.exit(0);
    });
  }
}
