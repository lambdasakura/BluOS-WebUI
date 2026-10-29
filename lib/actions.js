// プレーヤーの操作（CLI と MCP で共通）。player は createPlayer() の戻り値。
// 扱うのは状態の取得と再生操作まで。キューのクリア・プレイリストの削除・プリセットやアラームの変更は含めない
const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
const asArray = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
// 値が undefined の項目を除く（出力を短くする）
const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// Repeat: 0=キュー全体, 1=1 曲, 2=オフ
export const REPEAT_MODES = { all: '0', one: '1', off: '2' };
const REPEAT_NAMES = Object.fromEntries(Object.entries(REPEAT_MODES).map(([k, v]) => [v, k]));

export function summarizeStatus(s) {
  return compact({
    state: s.state,
    title: s.title1 ?? s.name,
    artist: s.artist ?? s.title2,
    album: s.album ?? s.title3,
    service: s.serviceName ?? s.service,
    position: num(s.secs),
    duration: num(s.totlen),
    volume: num(s.volume),
    mute: s.mute === '1',
    shuffle: s.shuffle === '1',
    repeat: REPEAT_NAMES[s.repeat],
    queueIndex: num(s.song),
    quality: s.streamFormat,
    sleepMinutes: num(s.sleep),
    radio: s.streamUrl ? true : undefined,
  });
}

async function rawStatus(player) {
  return (await player.get('/Status')).status || {}; // 空の <status/> は '' になる
}

export async function status(player) {
  return summarizeStatus(await rawStatus(player));
}

// 操作の後は新しい状態を返す
async function then(player, path) {
  await player.get(path);
  return status(player);
}

const track = (s) => compact({
  index: num(s.id), title: s.title, artist: s.art, album: s.alb, duration: num(s.time), service: s.service,
});

export async function queue(player, { start = 0, count = 50 } = {}) {
  const { playlist = {} } = await player.get(`/Playlist?start=${start}&end=${start + count - 1}`);
  return compact({ name: playlist.name, length: num(playlist.length), tracks: asArray(playlist.song).map(track) });
}

export async function playlists(player) {
  const { playlists: p } = await player.get('/Playlists');
  return asArray(p?.name).map((n) => (typeof n === 'object' ? n['#text'] ?? '' : String(n)));
}

export async function playlist(player, name) {
  const songs = await player.playlistSongs(name);
  return { name, tracks: songs.map((s) => compact({ title: s.title, artist: s.art, album: s.alb, duration: num(s.time), service: s.service })) };
}

export async function presets(player) {
  const { presets: p } = await player.get('/Presets');
  return asArray(p?.preset).map((x) => compact({ id: num(x.id), name: x.name }));
}

// Browse の項目から操作に使う属性だけを残す（画像などは省く）
const browseItem = (i) => compact({
  text: i.text, text2: i.text2, type: i.type,
  browseKey: i.browseKey, playURL: i.playURL, actionURL: i.actionURL, contextMenuKey: i.contextMenuKey,
});

// key を省くとソースの一覧（ルート）。limit 件を超える分は nextKey で続きを取れる
export async function browse(player, { key, query, limit = 100 } = {}) {
  const b = await player.browseAll(key, query, limit);
  let rest = limit;
  const take = (items) => {
    const out = items.slice(0, Math.max(rest, 0)).map(browseItem);
    rest -= out.length;
    return out;
  };
  const items = take(b.item);
  const categories = b.category.map((c) => ({ title: c.text, items: take(asArray(c.item)) })).filter((c) => c.items.length);
  return compact({
    title: b.serviceName, searchKey: b.searchKey, nextKey: b.nextKey,
    items: items.length ? items : undefined, categories: categories.length ? categories : undefined,
  });
}

// service: Browse のルートにある browseKey の名前（LocalMusic・Amazon・TuneIn など）
export async function search(player, query, { service = 'LocalMusic', limit = 100 } = {}) {
  const root = await player.browse(`${service}:`);
  if (!root.searchKey) throw new Error(`${service} は検索できません`);
  return browse(player, { key: root.searchKey, query, limit });
}

// 項目のメニュー（contextMenuKey）。各項目の actionURL を play_item で実行できる
export async function itemMenu(player, contextMenuKey) {
  return browse(player, { key: contextMenuKey });
}

export const play = (player) => then(player, '/Play');
export const pause = (player) => then(player, '/Pause');
export const stop = (player) => then(player, '/Stop');

// ストリーミングラジオは /Status の actions が示す URL で skip / back する
async function skipOrBack(player, name, fallback) {
  const s = await rawStatus(player);
  if (s.streamUrl) {
    const action = asArray(s.actions?.action).find((a) => a.name === name);
    if (!action?.url) throw new Error(`この局では「${name === 'skip' ? '次へ' : '前へ'}」を使えません`);
    return then(player, action.url);
  }
  return then(player, fallback);
}
export const next = (player) => skipOrBack(player, 'skip', '/Skip');
export const previous = (player) => skipOrBack(player, 'back', '/Back');

// level（0〜100）か delta（現在の音量からの増減）のどちらかを指定する
export async function setVolume(player, { level, delta }) {
  if (level === undefined) level = (num((await rawStatus(player)).volume) ?? 0) + (delta ?? 0);
  level = Math.min(100, Math.max(0, Math.round(level)));
  return then(player, `/Volume?level=${level}`);
}
export const setMute = (player, on) => then(player, `/Volume?mute=${on ? 1 : 0}`);
export const seek = (player, seconds) => then(player, `/Play?seek=${Math.max(0, Math.floor(seconds))}`);
export const setShuffle = (player, on) => then(player, `/Shuffle?state=${on ? 1 : 0}`);
export function setRepeat(player, mode) {
  if (!(mode in REPEAT_MODES)) throw new Error(`repeat は ${Object.keys(REPEAT_MODES).join(' / ')} のいずれか`);
  return then(player, `/Repeat?state=${REPEAT_MODES[mode]}`);
}
export const playQueueTrack = (player, index) => then(player, `/Play?id=${Math.floor(index)}`);
export const playPreset = (player, id) => then(player, `/Preset?id=${Math.floor(id)}`);

// パラメータは /Services の BluOS Playlists メニュー定義に合わせている（Web UI と同じ）
export const PLAYLIST_MODES = {
  now: 'playnow=1&clear=0&shuffle=0',
  shuffle: 'shuffle=1&playnow=1',
  next: 'playnow=-1&where=next',
  last: 'playnow=-1&where=last',
};
export function playPlaylist(player, name, mode = 'now') {
  if (!(mode in PLAYLIST_MODES)) throw new Error(`mode は ${Object.keys(PLAYLIST_MODES).join(' / ')} のいずれか`);
  return then(player, `/Add?playlist=${encodeURIComponent(name)}&${PLAYLIST_MODES[mode]}`);
}

// Browse の playURL・actionURL を実行する。再生・キューへの追加（/Play・/Add）だけを許可する
export function playItem(player, url) {
  const path = String(url).split('?')[0];
  if (path !== '/Play' && path !== '/Add') throw new Error('再生・キューへの追加の URL（/Play・/Add）だけを実行できます');
  return then(player, url);
}
