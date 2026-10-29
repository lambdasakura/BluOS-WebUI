// BluOS プレーヤーとの通信（XML → JSON 変換とページ送り）。Web サーバー・CLI・MCP で共通に使う
import { XMLParser } from 'fast-xml-parser';

// 要素数に関わらず配列として扱うタグ（song は /Status にも単一値として現れるためパスで限定）
const ARRAY_TAGS = new Set(['item', 'category']);
const ARRAY_PATHS = new Set(['playlist.song', 'presets.preset', 'playlists.name', 'songs.song',
  'folders.subfolders.folder', 'folders.songs.song',
  'addToPlaylistOptions.requestParameter', 'addToPlaylistOptions.playlists.name', 'alarms.alarm',
  'status.actions.action']);

export const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  htmlEntities: true, // &#39; などの数値文字参照も復号する（フォルダ名に現れる）
  isArray: (name, jpath, isLeaf, isAttr) => !isAttr && (ARRAY_TAGS.has(name) || ARRAY_PATHS.has(jpath)),
});

// /Songs は 1 回に 10 曲しか返さず総数も無いので、offset で最後までたどる
const SONGS_PAGE = 10;
const SONGS_MAX = 5000;
// Browse の一覧は途中までしか返さず nextKey で続きを示すことがある（BluOS のプレイリストは 10 件、ライブラリは 50 件など）
export const BROWSE_MAX = 2000;

// host: プレーヤーのホスト:ポート
export function createPlayer(host) {
  // XML 応答を JSON にして返す。<error> が返ったら例外にする
  async function get(path, { timeout = 20_000 } = {}) {
    const r = await fetch(`http://${host}${path}`, { signal: AbortSignal.timeout(timeout) });
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
    const parsed = parser.parse(text);
    delete parsed['?xml'];
    if (parsed.error) throw new Error(parsed.error.message ?? `player error: ${JSON.stringify(parsed.error)}`);
    return parsed;
  }

  // プレイリストの全曲
  async function playlistSongs(name) {
    const songs = [];
    while (songs.length < SONGS_MAX) {
      const page = (await get(`/Songs?playlist=${encodeURIComponent(name)}&offset=${songs.length}`, { timeout: 15_000 })).songs?.song ?? [];
      songs.push(...page);
      if (page.length < SONGS_PAGE) break;
    }
    return songs;
  }

  async function browse(key, q) {
    const qs = new URLSearchParams();
    if (key) qs.set('key', key);
    if (q) qs.set('q', q);
    return (await get(`/Browse${qs.size ? `?${qs}` : ''}`)).browse || {}; // 空の <browse/> は '' になる
  }

  // nextKey をたどり、max 件までまとめて返す（残りがあれば nextKey を付けたまま返す）
  async function browseAll(key, q, max = BROWSE_MAX) {
    const result = await browse(key, q);
    result.item ??= [];
    result.category ??= [];
    const count = () => result.item.length + result.category.reduce((n, c) => n + (c.item?.length ?? 0), 0);
    while (result.nextKey && count() < max) {
      const next = await browse(result.nextKey);
      result.item.push(...(next.item ?? []));
      for (const c of next.category ?? []) {
        const same = result.category.find((x) => x.text === c.text);
        if (same) (same.item ??= []).push(...(c.item ?? []));
        else result.category.push(c);
      }
      if (next.nextKey && next.nextKey !== result.nextKey) result.nextKey = next.nextKey;
      else delete result.nextKey;
    }
    return result;
  }

  return { host, get, playlistSongs, browse, browseAll };
}
