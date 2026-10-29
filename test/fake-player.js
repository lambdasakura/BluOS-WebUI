// テスト用の偽のプレーヤー（XML を返す HTTP サーバー）。パスごとの応答関数を routes に登録する（未登録は 404）
import http from 'node:http';
import { once } from 'node:events';

export const xml = (body) => `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;

export const sendXml = (body, type = 'text/xml') => (req, res) => {
  res.writeHead(200, { 'content-type': type });
  res.end(xml(body));
};

export async function startFakePlayer() {
  const routes = new Map();
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const url = new URL(req.url, 'http://player');
    const handler = routes.get(url.pathname);
    if (!handler) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('not found');
    }
    handler(req, res, url);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    host: `127.0.0.1:${server.address().port}`,
    routes,
    requests,
    reset() {
      routes.clear();
      requests.length = 0;
    },
    close() {
      server.closeAllConnections();
      server.close();
    },
  };
}
