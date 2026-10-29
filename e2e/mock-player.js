// ブラウザから見た /api/ 以下をすべて置き換えるモック。
// 応答は server.js が XML から変換した後の JSON 形式で返し、送信された URL を calls に記録する

// ハンドラーがこれを返すとエラー応答（{ error }）にする
export const fail = (error = 'boom', status = 502) => ({ [FAIL]: { status, error } });
const FAIL = Symbol('fail');
// ハンドラーがこれを返すと本文をそのまま返す（JSON でない応答など）
export const raw = (status, body, contentType = 'text/plain') => ({ [RAW]: { status, body, contentType } });
const RAW = Symbol('raw');

export const song = (id, extra = {}) => ({
  id: String(id), title: `Song ${id}`, art: `Artist ${id}`, alb: `Album ${id}`,
  fn: `/music/${id}.flac`, time: '200', service: 'LocalMusic', ...extra,
});

export class MockPlayer {
  constructor(page) {
    this.page = page;
    this.calls = [];
    this.handlers = new Map();
    this.statusWaiters = [];
    this.status = {
      etag: '1', state: 'pause', pid: '1', song: '0', title1: 'Song 0', title2: 'Artist 0', title3: 'Album 0',
      artist: 'Artist 0', album: 'Album 0', service: 'LocalMusic', serviceName: 'Library', fn: '/music/0.flac',
      image: '/Artwork?service=LocalMusic&fn=%2Fmusic%2F0.flac', streamFormat: 'FLAC 44.1kHz/16bit',
      secs: '10', totlen: '200', canSeek: '1', volume: '25', mute: '0', shuffle: '0', repeat: '2',
      isFavourite: '0', prid: '0',
    };
    this.queue = { name: 'My Queue', songs: [0, 1, 2].map((i) => song(i)) };
    this.playlists = [{ '#text': 'Chill', image: '/pl.png' }, 'Rock & Roll'];
    this.playlistSongs = {
      Chill: [song(10, { songid: 'sid10' }), song(11, { fn: undefined, songid: undefined, time: undefined }), song(12)],
      'Rock & Roll': [],
    };
    this.presets = [
      { id: '1', name: 'Morning', url: 'TuneIn:s1', image: '/p1.png' },
      { id: '2', name: 'Chill', url: '/Load?name=Chill', image: '' },
      { id: '3', name: 'TV', url: 'Capture:hdmi', image: '/p3.png' },
    ];
    this.inputs = [
      { id: 'input0', text: 'Optical', URL: 'Capture%3Aspdif', image: '/i0.png' },
      { id: 'input1', text: 'HDMI', URL: 'Capture%3Ahdmi', image: '/i1.png' },
    ];
    this.alarms = [];
    this.browse = { '': { item: [] } }; // key（検索は "key?q=語"）→ browse
    this.folders = {}; // path（ルートは ''）→ folders
    this.menus = {}; // contextMenuKey → browse
    this.addToPlaylistOptions = {
      urlPath: '/AddToPlaylist', requestParameter: ['songid=x'],
      playlists: { service: 'LocalMusic', create: '1', name: ['Chill', { '#text': 'Rock & Roll' }] },
    };
    this.sleepSteps = ['15', '30', '45', '60', '90', ''];
    this.sleepIndex = 5;
  }

  // path: '/Status' のような BluOS のパス、または '/api/browse' などの独自 API
  on(path, handler) {
    this.handlers.set(path, handler);
    return this;
  }

  // 状態を変えて、待機中の long polling に返す
  setStatus(patch) {
    Object.assign(this.status, patch, { etag: String(Number(this.status.etag) + 1) });
    for (const resolve of this.statusWaiters.splice(0)) resolve();
  }

  // 送信された URL（/api/d は除く）
  sent(pattern) {
    return this.calls.filter((c) => (pattern instanceof RegExp ? pattern.test(c) : c.startsWith(pattern)));
  }

  async install() {
    await this.page.route('**/api/**', (route) => this.handle(route));
  }

  async handle(route) {
    const url = new URL(route.request().url());
    const isDevice = url.pathname.startsWith('/api/d/');
    const path = isDevice ? url.pathname.slice('/api/d'.length) : url.pathname;
    this.calls.push(path + url.search);
    const handler = this.handlers.get(path) ?? ((u) => this.defaultResponse(path, u));
    let body;
    try {
      body = await handler(url, path);
    } catch (e) {
      body = fail(e.message);
    }
    try {
      if (body?.[RAW]) {
        await route.fulfill(body[RAW]);
      } else if (body?.[FAIL]) {
        await route.fulfill({ status: body[FAIL].status, contentType: 'application/json', body: JSON.stringify({ error: body[FAIL].error }) });
      } else if (body instanceof Buffer) {
        await route.fulfill({ status: 200, contentType: 'image/png', body });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body ?? {}) });
      }
    } catch {
      // テスト終了でページが閉じた後の応答は捨てる
    }
  }

  async defaultResponse(path, url) {
    const q = url.searchParams;
    switch (path) {
      case '/Status':
        if (q.get('etag') === this.status.etag) await new Promise((r) => this.statusWaiters.push(r));
        return { status: { ...this.status } };
      case '/SyncStatus':
        return { SyncStatus: { name: 'Living Room', brand: 'Bluesound', modelName: 'NODE' } };
      case '/Playlist': {
        const start = Number(q.get('start') ?? 0), end = Number(q.get('end') ?? 199);
        const songs = this.queue.songs.slice(start, end + 1);
        return { playlist: { name: this.queue.name, length: String(this.queue.songs.length), ...(songs.length ? { song: songs } : {}) } };
      }
      case '/Playlists':
        return { playlists: { name: this.playlists } };
      case '/api/playlist-songs':
        return { playlist: q.get('playlist'), songs: this.playlistSongs[q.get('playlist')] ?? [] };
      case '/Presets':
      case '/SetPreset':
        return { presets: { prid: this.status.prid, preset: this.presets } };
      case '/RadioBrowse':
        return { radiotime: { item: this.inputs } };
      case '/Alarms':
        return { alarms: { alarm: this.alarms } };
      case '/api/browse': {
        const key = (q.get('key') ?? '') + (q.get('q') ? `?q=${q.get('q')}` : '');
        return { browse: structuredClone(this.browse[key] ?? {}) };
      }
      case '/Browse':
        return { browse: this.menus[q.get('key')] ?? {} };
      case '/library/v1/Folders':
        return { folders: this.folders[q.get('path') ?? ''] ?? {} };
      case '/AddToPlaylistOptions':
        return { addToPlaylistOptions: this.addToPlaylistOptions };
      case '/Sleep':
        this.sleepIndex = (this.sleepIndex + 1) % this.sleepSteps.length;
        return { sleep: this.sleepSteps[this.sleepIndex] };
      case '/Artwork':
      case '/images':
        return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
      default:
        return {}; // Play / Add / Move など状態を変える操作は記録だけする
    }
  }
}
