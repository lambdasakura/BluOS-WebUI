// BluOS Web UI — BluOS API を /api/d/ 経由で呼び出す
const $ = (id) => document.getElementById(id);
const enc = encodeURIComponent;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const asArray = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  if (body.error) throw new Error(typeof body.error === 'string' ? body.error : body.error.message ?? JSON.stringify(body.error));
  return body;
}

function api(path) {
  return getJson('/api/d' + path);
}

// Browse の一覧を nextKey をたどってまとめて取得する（サーバー側で最大 2000 件。残りがあれば nextKey 付き）
async function browseAll(key, q) {
  const qs = new URLSearchParams();
  if (key) qs.set('key', key);
  if (q) qs.set('q', q);
  return (await getJson(`/api/browse?${qs}`)).browse ?? {};
}

// デバイス相対の画像パスはプロキシ経由にする
function imgSrc(src) {
  if (!src) return '';
  if (/^https?:\/\//.test(src)) return src;
  return '/api/d' + (src.startsWith('/') ? src : '/' + src);
}

function fmtTime(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children.flat().filter((c) => c != null && c !== false));
  return node;
}

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2500);
}

// 成功したら true を返す（失敗時はトーストを出して false）
async function run(path, okMsg) {
  try {
    await api(path);
    if (okMsg) toast(okMsg);
    return true;
  } catch (e) {
    toast(`エラー: ${e.message}`);
    return false;
  }
}

function thumb(src) {
  return src
    ? el('img', { class: 'thumb', src: imgSrc(src), loading: 'lazy', alt: '' })
    : el('div', { class: 'thumb ph' }, '♪');
}

// ───────────────────────── 再生状態 ─────────────────────────
const state = {
  status: null,
  secsAt: 0, // status.secs を受け取った時刻
  seeking: false,
  volumeHoldUntil: 0,
  pid: null,
};

function isPlaying(s) {
  return s && (s.state === 'play' || s.state === 'stream');
}

// tick() から state.status がある時だけ呼ぶ
function currentSecs() {
  const s = state.status;
  let secs = Number(s.secs) || 0;
  if (isPlaying(s)) secs += (Date.now() - state.secsAt) / 1000;
  const total = Number(s.totlen) || 0;
  return total ? Math.min(secs, total) : secs;
}

function applyStatus(s) {
  const prev = state.status;
  state.status = s;
  state.secsAt = Date.now();

  const title = s.title1 ?? s.name ?? '';
  const sub = [s.title2, s.title3].filter((v) => v && v !== title).join(' • ') ||
    [s.artist, s.album].filter(Boolean).join(' • ');
  $('title').textContent = title || (s.state === 'stop' ? '停止中' : '—');
  $('subtitle').textContent = sub;
  document.title = title ? `${title} — BluOS` : 'BluOS';

  const img = imgSrc(s.image);
  if (img) { if ($('art').getAttribute('src') !== img) $('art').src = img; }
  else $('art').removeAttribute('src');
  // 全画面表示の背景（ぼかしたアートワーク）
  $('player').style.setProperty('--art', img ? `url("${img.replace(/"/g, '%22')}")` : 'none');

  $('service').textContent = s.serviceName ?? s.service ?? '';
  $('quality').textContent = s.streamFormat ?? '';

  $('btnPlay').classList.toggle('playing', isPlaying(s));
  $('btnShuffle').classList.toggle('on', s.shuffle === '1');
  const repeat = s.repeat ?? '2'; // 0=キュー全体, 1=1曲, 2=オフ
  $('btnRepeat').classList.toggle('on', repeat !== '2');
  $('btnRepeat').classList.toggle('one', repeat === '1');

  if (Date.now() > state.volumeHoldUntil) {
    const vol = Math.max(0, Number(s.volume) || 0);
    $('volume').value = vol;
    $('volumeValue').textContent = vol;
  }
  $('btnMute').classList.toggle('muted-on', s.mute === '1');
  $('indexing').hidden = !s.indexing || s.indexing === '0';

  // ストリーミングラジオはキューを使わず、/Status の actions が示す URL で操作する
  state.actions = s.streamUrl ? Object.fromEntries(asArray(s.actions?.action).map((a) => [a.name, a])) : null;
  $('btnSkip').disabled = !!state.actions && !state.actions.skip?.url;
  $('btnBack').disabled = !!state.actions && !state.actions.back?.url;
  for (const [id, name] of [['btnLove', 'love'], ['btnBan', 'ban']]) {
    const a = state.actions?.[name];
    $(id).hidden = !a?.url;
    if (a) {
      $(id).title = a.text ?? $(id).title;
      $(id).classList.toggle('on', a.state === '1');
    }
  }
  $('btnSleep').classList.toggle('on', !!s.sleep);
  $('sleepValue').textContent = s.sleep ? s.sleep : '';
  $('btnSleep').title = s.sleep ? `スリープタイマー: 残り ${s.sleep} 分` : 'スリープタイマー';
  $('btnFav').hidden = !(s.service === 'LocalMusic' && s.fn);
  $('btnFav').classList.toggle('on', s.isFavourite === '1');
  $('btnNpMenu').hidden = !s.fn && !s.streamUrl;

  const total = Number(s.totlen) || 0;
  $('seek').max = total;
  $('seek').disabled = !(total && s.canSeek === '1');
  $('total').textContent = total ? fmtTime(total) : '';
  tick();

  if (s.pid !== state.pid) {
    state.pid = s.pid;
    loadQueue();
  } else if (prev?.song !== s.song) {
    highlightQueue();
  }
  highlightPresets();
}

function tick() {
  if (!state.status || state.seeking) return;
  const secs = currentSecs();
  $('seek').value = secs;
  $('elapsed').textContent = fmtTime(secs);
}
setInterval(tick, 500);

async function pollStatus() {
  let etag = null;
  for (;;) {
    try {
      const q = etag ? `/Status?timeout=90&etag=${enc(etag)}` : '/Status';
      const { status } = await api(q);
      etag = status.etag;
      $('conn').className = 'dot ok';
      applyStatus(status);
    } catch (e) {
      $('conn').className = 'dot ng';
      etag = null;
      await sleep(3000);
    }
  }
}

// ───────────────────────── 操作 ─────────────────────────
$('btnPlay').onclick = () => run(isPlaying(state.status) ? '/Pause' : '/Play');
async function runAction(a) {
  try {
    const res = await api(a.url);
    // 応答のルートが <response> ならその本文、そうでなければ action の notification を表示する
    const msg = typeof res.response === 'string' ? res.response : a.notification;
    if (msg) toast(msg);
  } catch (e) {
    toast(`エラー: ${e.message}`);
  }
}
$('btnSkip').onclick = () => (state.actions ? state.actions.skip && runAction(state.actions.skip) : run('/Skip'));
$('btnBack').onclick = () => (state.actions ? state.actions.back && runAction(state.actions.back) : run('/Back'));
$('btnLove').onclick = () => state.actions?.love && runAction(state.actions.love);
$('btnBan').onclick = () => state.actions?.ban && runAction(state.actions.ban);
$('btnShuffle').onclick = () => run(`/Shuffle?state=${state.status?.shuffle === '1' ? 0 : 1}`);
$('btnRepeat').onclick = () => {
  const next = { 2: 0, 0: 1, 1: 2 }[state.status?.repeat ?? '2'];
  run(`/Repeat?state=${next}`);
};
$('btnFav').onclick = async () => {
  const s = state.status;
  if (!s?.fn) return;
  const on = s.isFavourite === '1';
  const ok = await run(`/${on ? 'DeleteFavourite' : 'AddFavourite'}?fn=${enc(s.fn)}&service=LocalMusic`,
    on ? 'お気に入りから削除しました' : 'お気に入りに追加しました');
  if (!ok) return;
  s.isFavourite = on ? '0' : '1';
  $('btnFav').classList.toggle('on', !on);
  if (!$('tab-favourites').hidden) loadFavourites();
};
$('btnNpMenu').onclick = () => {
  const s = state.status;
  if (!s?.fn && !s?.streamUrl) return;
  const song = { title: s.title1 ?? s.name, artist: s.artist, album: s.album, service: s.service, fn: s.fn, isFavourite: s.isFavourite };
  const extra = s.streamUrl
    ? [{ text: 'プリセットに追加', fn: () => addPreset(s.title1 ?? s.name, s.streamUrl, s.stationImage ?? s.image) }]
    : [];
  showMenu(song.title, async () => [...songMenuEntries(song), ...extra]);
};
// /Sleep は引数を取らず、呼ぶたびに 15→30→45→60→90→オフ と切り替わる。
// 目的の値になるまで繰り返し呼ぶ（応答は新しい設定値、オフなら空）
const SLEEP_STEPS = ['15', '30', '45', '60', '90', ''];
async function setSleep(target) {
  try {
    for (let i = 0; i <= SLEEP_STEPS.length; i++) {
      const { sleep } = await api('/Sleep');
      if (String(sleep ?? '') === target) {
        toast(target ? `スリープタイマー: ${target} 分` : 'スリープタイマーを解除しました');
        return;
      }
    }
    toast('スリープタイマーを設定できませんでした');
  } catch (e) {
    toast(`エラー: ${e.message}`);
  }
}
$('btnSleep').onclick = () => {
  const remain = state.status?.sleep;
  showMenu(remain ? `スリープタイマー（残り ${remain} 分）` : 'スリープタイマー', async () => [
    ...SLEEP_STEPS.filter(Boolean).map((m) => ({ text: `${m} 分`, fn: () => setSleep(m) })),
    ...(remain ? [{ text: 'オフ', danger: true, fn: () => setSleep('') }] : []),
  ]);
};
$('btnMute').onclick = () => run(`/Volume?mute=${state.status?.mute === '1' ? 0 : 1}`);

let volTimer;
$('volume').addEventListener('input', (e) => {
  const v = e.target.value;
  $('volumeValue').textContent = v;
  state.volumeHoldUntil = Date.now() + 1500;
  clearTimeout(volTimer);
  volTimer = setTimeout(() => run(`/Volume?level=${v}`), 120);
});

$('seek').addEventListener('input', (e) => {
  state.seeking = true;
  $('elapsed').textContent = fmtTime(e.target.value);
});
$('seek').addEventListener('change', async (e) => {
  await run(`/Play?seek=${Math.floor(e.target.value)}`);
  state.seeking = false;
});

// ───────────────────────── 全画面表示（再生中の曲だけを表示） ─────────────────────────
// .player をそのままブラウザのウィンドウいっぱいのレイアウトに切り替える（操作・表示の更新処理は通常時と共通）。
// ディスプレイ全画面（Fullscreen API）は使わない
let wakeLock = null;
let pushedHash = false; // 自分で #nowplaying の履歴を積んだか（閉じる時に戻る）

async function requestWakeLock() {
  try {
    const lock = await navigator.wakeLock?.request('screen');
    if (!lock) return;
    if (!isFullView()) { lock.release().catch(() => {}); return; } // 取得中に全画面を抜けた
    wakeLock?.release().catch(() => {});
    wakeLock = lock;
  } catch {}
}

function isFullView() {
  return document.body.classList.contains('np-full');
}

// 表示の切り替え本体。URL の #nowplaying と連動させる（ブラウザの戻るで閉じられる）
function setFullView(on) {
  if (on === isFullView()) return;
  document.body.classList.toggle('np-full', on);
  document.body.classList.remove('np-ui-hidden');
  if (on) {
    requestWakeLock();
  } else {
    wakeLock?.release().catch(() => {});
    wakeLock = null;
  }
}

function enterFullView() {
  if (location.hash !== '#nowplaying') {
    pushedHash = true;
    location.hash = 'nowplaying'; // hashchange で setFullView(true)
  } else {
    setFullView(true);
  }
}

function exitFullView() {
  if (location.hash === '#nowplaying') {
    if (pushedHash) {
      pushedHash = false;
      history.back(); // hashchange で setFullView(false)
      return;
    }
    history.replaceState(null, '', location.pathname + location.search);
  }
  setFullView(false);
}

window.addEventListener('hashchange', () => {
  if (location.hash !== '#nowplaying') pushedHash = false;
  setFullView(location.hash === '#nowplaying');
});

$('btnFull').onclick = enterFullView;
$('btnFullClose').onclick = exitFullView;
// 通常時はアートワークで全画面へ、全画面ではアートワークのタップで操作 UI の表示を切り替える
$('artWrap').onclick = () => {
  if (isFullView()) document.body.classList.toggle('np-ui-hidden');
  else enterFullView();
};
document.addEventListener('visibilitychange', () => {
  // タブが隠れると Wake Lock は解放されるので、戻ったら取り直す
  if (document.visibilityState === 'visible' && isFullView()) requestWakeLock();
});

// ───────────────────────── キュー ─────────────────────────
// キューは QUEUE_PAGE 曲ずつ取得し、「さらに読み込む」で続きを追加する
const QUEUE_PAGE = 200;
let queueLoading = null;
let queueReload = false; // 読み込み中に再読み込みを頼まれた
let queueLength = 0;
let suppressClickUntil = 0; // ドラッグ直後の click で曲が再生されないようにする

function queueRow(s) {
  const li = el('li', {
    class: 'row', 'data-id': s.id,
    onclick: () => { if (Date.now() >= suppressClickUntil) run(`/Play?id=${s.id}`); },
  });
  li.append(
    el('span', {
      class: 'drag', title: 'ドラッグで並べ替え', 'aria-label': 'ドラッグで並べ替え',
      onpointerdown: (e) => startDrag(e, li), onclick: (e) => e.stopPropagation(),
    }, '⋮⋮'),
    thumb(s.image),
    el('div', { class: 'row-main' },
      el('div', { class: 'row-title' }, s.title ?? ''),
      el('div', { class: 'row-sub' }, [s.art, s.alb].filter(Boolean).join(' • '))),
    s.time ? el('span', { class: 'row-end' }, fmtTime(s.time)) : null,
    el('button', {
      class: 'row-btn', title: 'メニュー', 'aria-label': 'メニュー',
      onclick: (e) => {
        e.stopPropagation();
        const song = { title: s.title, artist: s.art, album: s.alb, service: s.service, fn: s.fn };
        showMenu(s.title, async () => songMenuEntries(song));
      },
    }, '⋯'),
    el('button', {
      class: 'row-btn', title: 'キューから削除', 'aria-label': 'キューから削除',
      onclick: (e) => { e.stopPropagation(); run(`/Delete?id=${s.id}`); },
    }, '×'));
  return li;
}

function updateQueueInfo(name) {
  const shown = $('queue').querySelectorAll('.row').length;
  $('queueInfo').textContent = queueLength
    ? `${name ? name + ' · ' : ''}${queueLength} 曲${queueLength > shown ? `（${shown} 曲を表示中）` : ''}`
    : '';
  $('btnQueueMore').hidden = shown >= queueLength;
}

// 再読み込み時は表示済みの曲数を保つ（スクロール位置の曲が消えないように）
async function loadQueue() {
  if (queueLoading) {
    queueReload = true;
    return queueLoading;
  }
  queueLoading = (async () => {
    do {
      queueReload = false;
      await fetchQueue();
    } while (queueReload);
  })().finally(() => (queueLoading = null));
  return queueLoading;
}

async function fetchQueue() {
  try {
    const count = Math.max(QUEUE_PAGE, $('queue').querySelectorAll('.row').length);
    const { playlist } = await api(`/Playlist?start=0&end=${count - 1}`);
    const songs = asArray(playlist?.song);
    queueLength = Number(playlist?.length ?? songs.length);
    state.queueName = playlist?.name ?? '';
    const list = $('queue');
    list.replaceChildren(...songs.map(queueRow));
    if (!songs.length) list.append(el('li', { class: 'empty' }, 'キューは空です'));
    updateQueueInfo(state.queueName);
    highlightQueue();
  } catch (e) {
    $('queue').replaceChildren(el('li', { class: 'empty' }, `キューを取得できません: ${e.message}`));
  }
}

$('btnQueueMore').onclick = async () => {
  const btn = $('btnQueueMore');
  btn.disabled = true;
  try {
    const start = $('queue').querySelectorAll('.row').length;
    const { playlist } = await api(`/Playlist?start=${start}&end=${start + QUEUE_PAGE - 1}`);
    $('queue').append(...asArray(playlist?.song).map(queueRow));
    updateQueueInfo(state.queueName);
    highlightQueue();
  } catch (e) {
    toast(`エラー: ${e.message}`);
  } finally {
    btn.disabled = false;
  }
};

function highlightQueue() {
  const cur = state.status?.song;
  for (const li of $('queue').children) {
    const on = li.dataset.id != null && li.dataset.id === cur;
    li.classList.toggle('current', on);
  }
}

$('btnClear').onclick = () => {
  if (confirm('キューをすべてクリアしますか？')) run('/Clear');
};

// ハンドルをドラッグしてキュー内の曲を移動する（マウス・タッチ共通）
function startDrag(e, li) {
  if (e.button !== 0) return;
  e.preventDefault();
  const list = $('queue');
  const from = [...list.children].indexOf(li);
  li.classList.add('dragging');
  // 行を DOM 上で移動するとポインターキャプチャが外れるため document で受ける

  const onMove = (ev) => {
    const y = ev.clientY;
    for (const other of list.children) {
      if (other === li) continue;
      const r = other.getBoundingClientRect();
      if (y >= r.top && y < r.bottom) {
        list.insertBefore(li, y < r.top + r.height / 2 ? other : other.nextSibling);
        break;
      }
    }
    // 画面端では自動スクロール
    if (y < 60) window.scrollBy(0, -12);
    else if (y > window.innerHeight - 60) window.scrollBy(0, 12);
  };
  const onUp = async () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    li.classList.remove('dragging');
    // 離した位置が同じ行の別の子要素だと click が行に届くので、直後の click は無視する
    suppressClickUntil = Date.now() + 400;
    const to = [...list.children].indexOf(li);
    if (to !== from) {
      await run(`/Move?old=${from}&new=${to}`);
      loadQueue();
    }
  };
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
}

$('btnSave').onclick = async () => {
  const name = prompt('プレイリスト名', state.queueName ?? '')?.trim();
  if (!name) return;
  try {
    const exists = (await fetchPlaylists()).some((p) => p.name === name);
    if (exists && !confirm(`プレイリスト「${name}」を上書きしますか？`)) return;
    await api(`/Save?name=${enc(name)}`);
    toast(`「${name}」に保存しました`);
    if (!pl.current) loadPlaylists();
  } catch (e) {
    toast(`エラー: ${e.message}`);
  }
};

// ───────────────────────── プレイリスト ─────────────────────────
const pl = { current: null }; // current: 詳細表示中のプレイリスト

async function fetchPlaylists() {
  const { playlists } = await api('/Playlists');
  return asArray(playlists?.name).map((n) =>
    typeof n === 'object' ? { name: n['#text'] ?? '', image: n.image } : { name: String(n) });
}

function playlistActions(p) {
  const q = enc(p.name);
  // パラメータは /Services の BluOS Playlists メニュー定義に合わせている
  return [
    { text: '再生', fn: () => run(`/Add?playlist=${q}&playnow=1&clear=0&shuffle=0`, `「${p.name}」を再生`) },
    { text: 'シャッフル再生', fn: () => run(`/Add?playlist=${q}&shuffle=1&playnow=1`, `「${p.name}」をシャッフル再生`) },
    { text: '次に追加', fn: () => run(`/Add?playlist=${q}&playnow=-1&where=next`, `「${p.name}」を次に追加`) },
    { text: '最後に追加', fn: () => run(`/Add?playlist=${q}&playnow=-1&where=last`, `「${p.name}」を最後に追加`) },
    { text: 'プリセットに追加', fn: () => addPreset(p.name, `/Load?name=${enc(p.name)}`, p.image) },
    { text: '削除', danger: true, fn: () => deletePlaylist(p) },
  ];
}

async function deletePlaylist(p) {
  if (!confirm(`プレイリスト「${p.name}」を削除しますか？`)) return;
  try {
    await api(`/Delete?name=${enc(p.name)}`);
    toast(`「${p.name}」を削除しました`);
    loadPlaylists();
  } catch (e) {
    toast(`エラー: ${e.message}`);
  }
}

async function loadPlaylists() {
  pl.current = null;
  $('btnPlBack').hidden = true;
  $('plActions').hidden = true;
  const list = $('playlists');
  try {
    const items = await fetchPlaylists();
    if (pl.current) return; // 読み込み中に詳細へ移動した
    $('plInfo').textContent = `${items.length} 件`;
    list.replaceChildren();
    if (!items.length) list.append(el('li', { class: 'empty' }, 'プレイリストはありません。キュー画面から保存できます'));
    for (const p of items) {
      list.append(el('li', { class: 'row', onclick: () => openPlaylist(p) },
        thumb(p.image),
        el('div', { class: 'row-main' }, el('div', { class: 'row-title' }, p.name)),
        el('button', {
          class: 'row-btn', title: '再生', 'aria-label': '再生',
          onclick: (e) => { e.stopPropagation(); playlistActions(p)[0].fn(); },
        }, '▶'),
        el('button', {
          class: 'row-btn', title: 'メニュー', 'aria-label': 'メニュー',
          onclick: (e) => { e.stopPropagation(); showMenu(p.name, async () => playlistActions(p)); },
        }, '⋯')));
    }
  } catch (e) {
    list.replaceChildren(el('li', { class: 'empty' }, `取得できません: ${e.message}`));
  }
}

function songImage(s) {
  if (s.songid) return `/Artwork?service=${enc(s.service ?? '')}&songid=${enc(s.songid)}`;
  if (s.fn) return `/Artwork?service=${enc(s.service ?? 'LocalMusic')}&fn=${enc(s.fn)}`;
  return '';
}

async function openPlaylist(p) {
  pl.current = p;
  $('btnPlBack').hidden = false;
  $('plInfo').textContent = p.name;
  const actions = $('plActions');
  actions.replaceChildren(...playlistActions(p).map((a) =>
    el('button', { class: `text-btn${a.danger ? ' danger' : ''}`, onclick: a.fn }, a.text)));
  actions.hidden = false;
  const list = $('playlists');
  list.replaceChildren(el('li', { class: 'empty' }, '読み込み中…'));
  try {
    // /Songs は 10 曲ずつしか返さないので、サーバー側で全ページをまとめたものを取得する
    const body = await getJson(`/api/playlist-songs?playlist=${enc(p.name)}`);
    if (pl.current !== p) return; // 読み込み中に別の画面へ移動した
    const items = asArray(body.songs);
    const total = items.reduce((sum, s) => sum + (Number(s.time) || 0), 0);
    $('plInfo').textContent = `${p.name} · ${items.length} 曲${total ? ` · ${fmtTime(total)}` : ''}`;
    list.replaceChildren(...items.map((s) => el('li', { class: 'row static' },
      thumb(songImage(s)),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title' }, s.title ?? ''),
        el('div', { class: 'row-sub' }, [s.art, s.alb].filter(Boolean).join(' • '))),
      s.time ? el('span', { class: 'row-end' }, fmtTime(s.time)) : null)));
    if (!items.length) list.append(el('li', { class: 'empty' }, '曲がありません'));
  } catch (e) {
    if (pl.current === p) list.replaceChildren(el('li', { class: 'empty' }, `取得できません: ${e.message}`));
  }
}

$('btnPlBack').onclick = () => loadPlaylists();

// ───────────────────────── プリセット・入力 ─────────────────────────
let presetsLoaded = false;
let presetsEditing = false;
let presetList = [];

async function loadPresets() {
  presetsLoaded = true;
  const [presetsRes, inputsRes] = await Promise.allSettled([api('/Presets'), api('/RadioBrowse?service=Capture')]);
  const igrid = $('inputs');
  if (inputsRes.status === 'fulfilled') {
    const { radiotime } = inputsRes.value;
    igrid.replaceChildren();
    for (const i of asArray(radiotime?.item)) {
      const tile = el('div', { class: 'tile-wrap' },
        el('button', { class: 'tile', 'data-input': i.id, onclick: () => run(`/Play?url=${i.URL}`, `${i.text} に切り替え`) },
          el('img', { src: imgSrc(i.image), alt: '', loading: 'lazy' }),
          el('span', {}, i.text)),
        el('div', { class: 'tile-tools edit-only' },
          el('button', { class: 'text-btn', onclick: () => addPreset(i.text, decodeURIComponent(i.URL), i.image) }, '＋ プリセットに追加')));
      igrid.append(tile);
    }
  } else {
    igrid.replaceChildren(el('div', { class: 'empty' }, `取得できません: ${inputsRes.reason.message}`));
  }
  if (presetsRes.status === 'fulfilled') {
    renderPresets(presetsRes.value.presets);
  } else {
    $('presets').replaceChildren(el('div', { class: 'empty' }, `取得できません: ${presetsRes.reason.message}`));
  }
  if (presetsRes.status === 'rejected' || inputsRes.status === 'rejected') presetsLoaded = false; // 次に開いた時に取り直す
  highlightPresets();
}

// /SetPreset の応答は更新後のプリセット一覧
function renderPresets(presets) {
  presetList = asArray(presets?.preset);
  const pgrid = $('presets');
  pgrid.replaceChildren();
  if (!presetList.length) pgrid.append(el('div', { class: 'empty' }, 'プリセットはありません'));
  presetList.forEach((p, idx) => {
    pgrid.append(el('div', { class: 'tile-wrap' },
      el('button', {
        class: 'tile', 'data-preset': p.id,
        onclick: () => (presetsEditing ? renamePreset(p) : run(`/Preset?id=${p.id}`, `${p.name} を再生`)),
      },
        el('img', { src: imgSrc(p.image), alt: '', loading: 'lazy' }),
        el('span', {}, `${p.id}. ${p.name}`)),
      el('div', { class: 'tile-tools edit-only' },
        el('button', { class: 'row-btn', title: '前へ', 'aria-label': '前へ', disabled: idx === 0, onclick: () => swapPresets(idx, idx - 1) }, '◀'),
        el('button', { class: 'row-btn', title: '名前を変更', 'aria-label': '名前を変更', onclick: () => renamePreset(p) }, '✎'),
        el('button', { class: 'row-btn danger', title: '削除', 'aria-label': '削除', onclick: () => deletePreset(p) }, '🗑'),
        el('button', { class: 'row-btn', title: '次へ', 'aria-label': '次へ', disabled: idx === presetList.length - 1, onclick: () => swapPresets(idx, idx + 1) }, '▶'))));
  });
  highlightPresets();
}

// プリセットの書き込み。id を指定すると上書き、省略すると空き番号に追加（BluOS の Add preset と同じ形式）
function presetQuery({ id, name, url, image }) {
  const q = new URLSearchParams();
  if (id) q.set('id', id);
  if (name != null) q.set('name', name);
  if (url != null) q.set('url', url);
  if (image) q.set('image', image);
  return `/SetPreset?${q}`;
}

async function savePresets(requests, okMsg) {
  try {
    let result;
    for (const r of requests) result = await api(r);
    if (result?.presets !== undefined) renderPresets(result.presets);
    else await loadPresets();
    if (okMsg) toast(okMsg);
  } catch (e) {
    toast(`エラー: ${e.message}`);
    loadPresets();
  }
}

function addPreset(name, url, image) {
  return savePresets([presetQuery({ name, url, image })], `「${name}」をプリセットに追加しました`);
}

function renamePreset(p) {
  const name = prompt('プリセット名', p.name)?.trim();
  if (!name || name === p.name) return;
  savePresets([presetQuery({ id: p.id, name, url: p.url, image: p.image })], '名前を変更しました');
}

function deletePreset(p) {
  if (!confirm(`プリセット「${p.name}」を削除しますか？`)) return;
  savePresets([`/SetPreset?id=${enc(p.id)}`], `「${p.name}」を削除しました`); // id だけ指定すると削除
}

// 並べ替え専用の API はないので、2 つのプリセットの番号を入れ替えて書き直す
function swapPresets(i, j) {
  const a = presetList[i], b = presetList[j]; // 端のボタンは無効なので i, j は常に範囲内
  savePresets([
    presetQuery({ id: a.id, name: b.name, url: b.url, image: b.image }),
    presetQuery({ id: b.id, name: a.name, url: a.url, image: a.image }),
  ]);
}

$('btnPresetEdit').onclick = () => {
  presetsEditing = !presetsEditing;
  $('tab-presets').classList.toggle('editing', presetsEditing);
  $('btnPresetEdit').textContent = presetsEditing ? '完了' : '編集';
};

function highlightPresets() {
  const s = state.status;
  for (const t of $('presets').querySelectorAll('.tile')) t.classList.toggle('current', !!s && s.prid !== '0' && t.dataset.preset === s.prid);
  for (const t of $('inputs').querySelectorAll('.tile')) t.classList.toggle('current', !!s && t.dataset.input === s.inputId);
}

// ───────────────────────── お気に入り ─────────────────────────
// ライブラリのお気に入りは分類ごとの Browse キー、TuneIn は RadioBrowse の presets。
// Amazon Music と BluOS Radio (Airable) はお気に入り一覧を返すメニューが無い
const FAVOURITE_SECTIONS = [
  { title: '曲', key: 'LocalMusic:Song/%2Flibrary%2Fv1%2FSongs%3Fcategory=FAVOURITES&service=LocalMusic', parent: 'Library' },
  { title: 'アルバム', key: 'LocalMusic:Album/%2Flibrary%2Fv1%2FAlbums%3Fcategory=FAVOURITES&service=LocalMusic', parent: 'Library' },
  { title: 'アーティスト', key: 'LocalMusic:Artist/%2Flibrary%2Fv1%2FArtists%3Fcategory=FAVOURITES&service=LocalMusic', parent: 'Library' },
  { title: 'プレイリスト', key: 'LocalMusic:Playlist/%2Flibrary%2Fv1%2FPlaylists%3Fcategory=FAVOURITES&service=LocalMusic', parent: 'Library' },
  { title: 'ラジオ局（TuneIn）', key: 'TuneIn:BrowseMenu/%2FRadioBrowse%3Fservice=TuneIn&url=presets', parent: 'TuneIn' },
];

// お気に入りから開いた項目はブラウズタブで表示する
function openFromFavourites(key, title, parent) {
  const root = parent === 'TuneIn' ? { key: 'TuneIn:', title: 'TuneIn' } : { key: 'LocalMusic:', title: 'Library' };
  browseStack.splice(0, browseStack.length, { key: null, title: 'ソース' }, root);
  switchTab('browse');
  browseTo({ key, title });
}

let favouritesLoading = null;
async function loadFavourites() {
  if (favouritesLoading) return favouritesLoading;
  favouritesLoading = (async () => {
    const container = $('favourites');
    if (!container.children.length) container.append(el('div', { class: 'empty' }, '読み込み中…'));
    const results = await Promise.all(FAVOURITE_SECTIONS.map((sec) =>
      browseAll(sec.key).catch((e) => ({ error: e.message }))));
    const blocks = [];
    let total = 0;
    FAVOURITE_SECTIONS.forEach((sec, idx) => {
      const b = results[idx];
      const items = [...asArray(b.item), ...asArray(b.category).flatMap((c) => asArray(c.item))];
      if (b.error) {
        blocks.push(el('div', { class: 'cat-title' }, sec.title), el('div', { class: 'empty' }, `取得できません: ${b.error}`));
        return;
      }
      if (!items.length) return;
      total += items.length;
      const opts = { onBrowse: (key, title) => openFromFavourites(key, title, sec.parent), onChange: () => loadFavourites() };
      blocks.push(
        el('div', { class: 'section-head' },
          el('h3', {}, `${sec.title}（${items.length}${b.nextKey ? '+' : ''}）`),
          b.playURL ? el('button', { class: 'text-btn', onclick: () => run(b.playURL, `お気に入りの${sec.title}を再生`) }, '▶ すべて再生') : null,
          b.nextKey ? el('button', { class: 'text-btn', onclick: () => openFromFavourites(sec.key, `お気に入りの${sec.title}`, sec.parent) }, 'すべて表示') : null),
        renderItems(items, opts));
    });
    $('favInfo').textContent = total ? `${total} 件` : '';
    container.replaceChildren(...(blocks.length ? blocks : [el('div', { class: 'empty' },
      'お気に入りはありません。曲のメニュー（⋯）や再生中の ♡ から追加できます')]));
  })().finally(() => { favouritesLoading = null; });
  return favouritesLoading;
}
$('btnFavReload').onclick = () => loadFavourites();

// ───────────────────────── アラーム ─────────────────────────
// 公式ドキュメント外の API（BluShell の調査結果に基づく）:
//   /Alarms                  一覧（<alarm id hour minute days duration source volume fadein enable url image/>）
//   /Alarms?hour=..&...      追加（id を付けると更新、id と delete=1 で削除）。応答は更新後の一覧
//   days は日曜始まり 7 桁の 0/1、duration は自動停止までの分（0 は停止しない）
const ALARM_CURRENT = 'Current play queue or station'; // 公式アプリが使う「現在のキュー／局」の source 値
const ALARM_KEEP = 'keep'; // プリセットに無い音源（公式アプリで設定した局など）をそのまま残す選択肢
const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];
let alarmsLoaded = false;
let alarmEditing = null; // 編集中のアラーム（新規は null）
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

async function loadAlarms(data) {
  alarmsLoaded = true;
  const list = $('alarms');
  try {
    const { alarms } = data ?? (await api(`/Alarms?tz=${enc(TZ)}`));
    renderAlarms(asArray(alarms?.alarm));
  } catch (e) {
    alarmsLoaded = false;
    list.replaceChildren(el('li', { class: 'empty' }, `取得できません: ${e.message}`));
  }
}

function daysText(days) {
  if (!days || !/1/.test(days)) return '1 回のみ';
  if (days === '1111111') return '毎日';
  if (days === '0111110') return '平日';
  if (days === '1000001') return '週末';
  return [...days].map((d, i) => (d === '1' ? DAY_NAMES[i] : '')).join('');
}

function renderAlarms(alarms) {
  const list = $('alarms');
  list.replaceChildren();
  $('alarmInfo').textContent = alarms.length ? `${alarms.length} 件` : '';
  if (!alarms.length) list.append(el('li', { class: 'empty' }, 'アラームはありません'));
  alarms.sort((a, b) => (a.hour * 60 + +a.minute) - (b.hour * 60 + +b.minute));
  for (const a of alarms) {
    const time = `${String(a.hour).padStart(2, '0')}:${String(a.minute).padStart(2, '0')}`;
    const on = a.enable !== '0';
    const detail = [a.source === ALARM_CURRENT ? '現在のキュー／局' : a.source,
      `音量 ${a.volume}`, a.duration === '0' ? '自動停止なし' : `${a.duration} 分で停止`, a.fadein === '1' ? 'フェードイン' : null];
    list.append(el('li', { class: `row alarm${on ? '' : ' off'}`, onclick: () => openAlarmForm(a) },
      el('div', { class: 'alarm-time' }, time),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title' }, daysText(a.days)),
        el('div', { class: 'row-sub' }, detail.filter(Boolean).join(' • '))),
      el('label', { class: 'switch', title: on ? '有効' : '無効', onclick: (e) => e.stopPropagation() },
        el('input', { type: 'checkbox', checked: on, onchange: (e) => saveAlarm({ ...alarmParams(a), enable: e.target.checked ? 1 : 0 }) }),
        el('span')),
      el('button', {
        class: 'row-btn danger', title: '削除', 'aria-label': '削除',
        onclick: (e) => {
          e.stopPropagation();
          if (confirm(`${time} のアラームを削除しますか？`)) saveAlarm({ id: a.id, delete: 1 }, 'アラームを削除しました');
        },
      }, '🗑')));
  }
}

// 一覧の値から更新用のパラメータを組み立てる（応答は fadein、要求は fadeIn）
function alarmParams(a) {
  return {
    id: a.id, hour: a.hour, minute: a.minute, days: a.days ?? '0000000',
    volume: a.volume, duration: a.duration, fadeIn: a.fadein === '1' ? 1 : 0,
    enable: a.enable === '0' ? 0 : 1, source: a.source ?? ALARM_CURRENT,
    ...(a.url ? { url: a.url, image: a.image ?? '' } : {}),
  };
}

async function saveAlarm(params, okMsg) {
  try {
    const q = new URLSearchParams({ ...params, tz: TZ });
    const data = await api(`/Alarms?${q}`);
    await loadAlarms(data.alarms !== undefined ? data : undefined);
    if (okMsg) toast(okMsg);
  } catch (e) {
    toast(`エラー: ${e.message}`);
    loadAlarms();
  }
}

// 音源の候補は「現在のキュー／局」とプリセット
async function fillAlarmSources(selected) {
  const sel = $('alarmSource');
  let presets = presetList;
  if (!presets.length) {
    try { presets = asArray((await api('/Presets')).presets?.preset); } catch {}
  }
  const match = presets.find((p) => selected?.url && p.url === selected.url);
  const keep = selected && !match && (selected.url || (selected.source && selected.source !== ALARM_CURRENT));
  sel.replaceChildren(
    keep ? el('option', { value: ALARM_KEEP }, `現在の設定（${selected.source || selected.url}）`) : null,
    el('option', { value: '' }, '現在のキュー／局'),
    ...presets.map((p) => el('option', { value: p.id }, `プリセット ${p.id}. ${p.name}`)));
  sel.dataset.presets = JSON.stringify(presets);
  sel.value = match ? match.id : keep ? ALARM_KEEP : '';
}

async function openAlarmForm(alarm) {
  alarmEditing = alarm;
  const f = $('alarmForm');
  const a = alarm ?? { hour: 7, minute: 0, days: '0111110', volume: 30, duration: 60, fadein: '0' };
  $('alarmTime').value = `${String(a.hour).padStart(2, '0')}:${String(a.minute).padStart(2, '0')}`;
  for (const cb of f.querySelectorAll('.days input')) cb.checked = a.days?.[cb.value] === '1';
  $('alarmVolume').value = a.volume;
  $('alarmVolumeValue').textContent = a.volume;
  $('alarmDuration').value = String(a.duration);
  $('alarmFade').checked = a.fadein === '1';
  await fillAlarmSources(alarm);
  f.hidden = false;
  $('btnAlarmNew').hidden = true;
  f.scrollIntoView({ block: 'nearest' });
}

function closeAlarmForm() {
  $('alarmForm').hidden = true;
  $('btnAlarmNew').hidden = false;
  alarmEditing = null;
}

$('btnAlarmNew').onclick = () => openAlarmForm(null);
$('alarmCancel').onclick = closeAlarmForm;
$('alarmVolume').addEventListener('input', (e) => ($('alarmVolumeValue').textContent = e.target.value));
$('alarmForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const [hour, minute] = $('alarmTime').value.split(':').map(Number);
  const days = [...$('alarmForm').querySelectorAll('.days input')].map((cb) => (cb.checked ? '1' : '0')).join('');
  const presets = JSON.parse($('alarmSource').dataset.presets); // フォームを開く時に fillAlarmSources で設定済み
  const keep = $('alarmSource').value === ALARM_KEEP && alarmEditing;
  const preset = presets.find((p) => p.id === $('alarmSource').value);
  const source = keep
    ? { source: alarmEditing.source ?? ALARM_CURRENT, ...(alarmEditing.url ? { url: alarmEditing.url, image: alarmEditing.image ?? '' } : {}) }
    : { source: preset ? preset.name : ALARM_CURRENT, ...(preset ? { url: preset.url, image: preset.image ?? '' } : {}) };
  const params = {
    hour, minute, days,
    volume: $('alarmVolume').value,
    duration: $('alarmDuration').value,
    fadeIn: $('alarmFade').checked ? 1 : 0,
    enable: 1,
    ...source,
    ...(alarmEditing ? { id: alarmEditing.id } : {}),
  };
  const msg = alarmEditing ? 'アラームを更新しました' : 'アラームを追加しました';
  closeAlarmForm();
  saveAlarm(params, msg);
});

// ───────────────────────── ブラウズ ─────────────────────────
const browseStack = []; // { key, q, title } または フォルダ表示時 { folder, title }

async function browseTo(entry, push = true) {
  if (push) browseStack.push(entry);
  const container = $('browse');
  container.replaceChildren(el('div', { class: 'empty' }, '読み込み中…'));
  $('btnBrowseBack').hidden = browseStack.length <= 1;
  $('crumbs').textContent = browseStack.map((e) => e.title).join(' › ');
  const isCurrent = () => browseStack[browseStack.length - 1] === entry; // 読み込み中に移動していないか
  try {
    if (entry.folder != null) return await renderFolder(entry);
    const b = await browseAll(entry.key, entry.q);
    if (isCurrent()) renderBrowse(b, entry);
  } catch (e) {
    if (isCurrent()) container.replaceChildren(el('div', { class: 'empty' }, `取得できません: ${e.message}`));
  }
}

function renderBrowse(b, entry) {
  const container = $('browse');
  container.replaceChildren();

  // 検索
  const form = $('searchForm');
  form.hidden = !b.searchKey;
  form.dataset.key = b.searchKey ?? '';
  form.dataset.service = b.serviceName ?? '';
  if (!entry.q) $('searchInput').value = '';

  // 一覧全体の再生
  const actions = $('browseActions');
  actions.replaceChildren();
  if (b.playURL) {
    actions.append(el('button', { class: 'text-btn', onclick: () => run(b.playURL, '再生します') }, '▶ すべて再生'));
  }
  actions.hidden = !actions.children.length;

  const items = asArray(b.item);
  const cats = asArray(b.category);

  if (items.length && items.every((i) => i.type === 'section')) {
    container.append(el('div', { class: 'sections' },
      items.map((i) => el('button', { onclick: () => browseTo({ key: i.browseKey, title: i.text }) },
        i.text, i.text2 ? el('small', {}, i.text2) : null))));
  } else if (items.length) {
    container.append(renderItems(items));
  }
  for (const c of cats) {
    container.append(el('div', { class: 'cat-title' }, c.text ?? ''));
    container.append(renderItems(asArray(c.item)));
  }
  if (!items.length && !cats.length) container.append(el('div', { class: 'empty' }, '項目がありません'));

  // ライブラリのメニューには New・フォルダ表示・再スキャンが含まれないので追加する
  if (entry.key === 'LocalMusic:') {
    const row = (icon, title, sub, onclick) => el('li', { class: 'row', onclick },
      el('div', { class: 'thumb ph folder' }, icon),
      el('div', { class: 'row-main' }, el('div', { class: 'row-title' }, title), el('div', { class: 'row-sub' }, sub)));
    container.append(el('ul', { class: 'list' },
      row('🆕', 'New', '最近追加されたアルバム', () => browseTo({ key: 'LocalMusic:Album/%2Flibrary%2Fv1%2FAlbums%3Frecent%3D1%26service%3DLocalMusic', title: 'New' })),
      row('📁', 'Folders', 'フォルダから探す', () => browseTo({ folder: '', title: 'Folders' })),
      row('🔄', 'ライブラリを再スキャン', 'NAS などに追加した曲を読み込み直す', () => {
        if (confirm('ライブラリを再スキャンしますか？（曲数によっては時間がかかります）')) run('/Reindex', '再スキャンを開始しました');
      })));
  }

  if (b.nextKey) {
    const more = el('button', {
      class: 'text-btn', style: 'margin:12px auto;display:block',
      onclick: async () => {
        more.disabled = true;
        try {
          const nb = await browseAll(b.nextKey);
          if (browseStack[browseStack.length - 1] !== entry) return; // 読み込み中に移動した
          more.remove();
          container.append(renderItems([...asArray(nb.item), ...asArray(nb.category).flatMap((c) => asArray(c.item))]));
          if (nb.nextKey) { b.nextKey = nb.nextKey; container.append(more); more.disabled = false; }
        } catch (e) { toast(`エラー: ${e.message}`); more.disabled = false; }
      },
    }, 'さらに読み込む');
    container.append(more);
  }
}

// ───────────────────────── フォルダ表示（ライブラリ） ─────────────────────────
function folderIcon() {
  return el('div', { class: 'thumb ph folder' }, '📁');
}

// パラメータは /Services の LocalMusic Folder / Song メニュー定義に合わせている
function folderActions(path, name) {
  const q = `service=LocalMusic&path=${enc(path)}`;
  return [
    { text: '再生', fn: () => run(`/Add?${q}&playnow=1&clear=0&shuffle=0&where=next`, `「${name}」を再生`) },
    { text: 'シャッフル再生', fn: () => run(`/Add?${q}&playnow=1&shuffle=1&where=next`, `「${name}」をシャッフル再生`) },
    { text: '最後に追加', fn: () => run(`/Add?${q}&playnow=-1`, `「${name}」を最後に追加`) },
  ];
}

function fileActions(s) {
  const q = `service=LocalMusic&file=${enc(s.fn)}`;
  return [
    { text: '再生', fn: () => run(`/Add?${q}&playnow=1&clear=0&where=next`, `${s.title} を再生`) },
    { text: '次に追加', fn: () => run(`/Add?${q}&playnow=-1&where=next`, `${s.title} を次に追加`) },
    { text: '最後に追加', fn: () => run(`/Add?${q}&playnow=-1&where=last`, `${s.title} を最後に追加`) },
  ];
}

async function renderFolder(entry) {
  const path = entry.folder;
  const { folders } = await api(`/library/v1/Folders?service=LocalMusic${path ? `&path=${enc(path)}` : ''}`);
  if (browseStack[browseStack.length - 1] !== entry) return; // 読み込み中に移動した
  const container = $('browse');
  container.replaceChildren();
  $('searchForm').hidden = true;

  const actions = $('browseActions');
  actions.replaceChildren(...(path ? folderActions(path, entry.title) : []).map((a) =>
    el('button', { class: 'text-btn', onclick: a.fn }, a.text)));
  actions.hidden = !actions.children.length;

  const subfolders = asArray(folders?.subfolders?.folder).map(String);
  const songs = asArray(folders?.songs?.song);
  const list = el('ul', { class: 'list' });
  for (const name of subfolders) {
    // ルートだけはフルパス、それ以下は親からの相対名が返る
    const child = path ? `${path}/${name}` : name;
    list.append(el('li', { class: 'row', onclick: () => browseTo({ folder: child, title: name }) },
      folderIcon(),
      el('div', { class: 'row-main' }, el('div', { class: 'row-title' }, name)),
      el('button', {
        class: 'row-btn', title: 'メニュー', 'aria-label': 'メニュー',
        onclick: (e) => { e.stopPropagation(); showMenu(name, async () => folderActions(child, name)); },
      }, '⋯')));
  }
  for (const s of songs) {
    list.append(el('li', { class: 'row', onclick: () => fileActions(s)[0].fn() },
      thumb(`/Artwork?service=LocalMusic&fn=${enc(s.fn)}`),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title' }, s.title ?? s.fn.split('/').pop()),
        el('div', { class: 'row-sub' }, [s.art, s.alb].filter(Boolean).join(' • '))),
      s.time ? el('span', { class: 'row-end' }, fmtTime(s.time)) : null,
      el('button', {
        class: 'row-btn', title: 'メニュー', 'aria-label': 'メニュー',
        onclick: (e) => {
          e.stopPropagation();
          const song = { title: s.title, artist: s.art, album: s.alb, service: 'LocalMusic', fn: s.fn };
          showMenu(s.title, async () => [...fileActions(s), ...songMenuEntries(song)]);
        },
      }, '⋯')));
  }
  if (!subfolders.length && !songs.length) list.append(el('li', { class: 'empty' }, '項目がありません'));
  container.append(list);
}

// opts.onBrowse: 下の階層を開く処理（既定はブラウズタブ内で移動）、opts.onChange: メニュー操作後の再読み込み
function renderItems(items, opts = {}) {
  const onBrowse = opts.onBrowse ?? ((key, title) => browseTo({ key, title }));
  return el('ul', { class: 'list' }, items.map((i) => {
    const play = i.autoplayURL ?? i.playURL;
    const onclick = i.browseKey
      ? () => onBrowse(i.browseKey, i.text)
      : play ? () => run(play, `${i.text} を再生`) : null;
    const end = i.duration ? fmtTime(i.duration) : i.tracks ? `${i.tracks} 曲` : null;
    return el('li', { class: 'row', onclick },
      thumb(i.image),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title' }, i.text ?? ''),
        i.text2 ? el('div', { class: 'row-sub' }, i.text2) : null),
      end ? el('span', { class: 'row-end' }, end) : null,
      i.browseKey && i.playURL
        ? el('button', { class: 'row-btn', title: '再生', 'aria-label': '再生', onclick: (e) => { e.stopPropagation(); run(i.playURL, `${i.text} を再生`); } }, '▶')
        : null,
      i.contextMenuKey
        ? el('button', { class: 'row-btn', title: 'メニュー', 'aria-label': 'メニュー', onclick: (e) => { e.stopPropagation(); openMenu(i, opts.onChange); } }, '⋯')
        : null);
  }));
}

$('btnBrowseBack').onclick = () => {
  browseStack.pop();
  browseTo(browseStack[browseStack.length - 1], false);
};

$('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('searchInput').value.trim();
  const key = e.target.dataset.key;
  if (!q || !key) return;
  browseTo({ key, q, title: `検索「${q}」` });
});

// ───────────────────────── コンテキストメニュー ─────────────────────────
// entries: 読み込み関数。[{ text, fn, danger? }] を返す
let menuSeq = 0; // 開くたび・閉じるたびに進め、古い読み込み結果を捨てる
async function showMenu(title, loadEntries) {
  const seq = ++menuSeq;
  $('menuTitle').textContent = title ?? '';
  const box = $('menuItems');
  box.replaceChildren(el('div', { class: 'empty' }, '読み込み中…'));
  $('menu').hidden = false;
  try {
    const entries = await loadEntries();
    if (seq !== menuSeq) return;
    box.replaceChildren();
    if (!entries.length) box.append(el('div', { class: 'empty' }, '操作はありません'));
    for (const m of entries) {
      box.append(el('button', { class: m.danger ? 'danger' : null, onclick: () => { closeMenu(); m.fn(); } }, m.text));
    }
  } catch (e) {
    if (seq === menuSeq) box.replaceChildren(el('div', { class: 'empty' }, `取得できません: ${e.message}`));
  }
}

// ブラウズ項目のメニューはプレーヤーから取得する
function openMenu(item, onChange) {
  showMenu(item.text, async () => {
    const data = await api(`/Browse?key=${enc(item.contextMenuKey)}`);
    const entries = asArray(data.browse?.item).map((m) => ({
      text: m.text,
      fn: () => {
        if (m.actionURL) run(m.actionURL, `${m.text}: ${item.text}`).then(() => onChange?.());
        else if (m.browseKey) { switchTab('browse'); browseTo({ key: m.browseKey, title: m.text }); }
      },
    }));
    return [...entries, ...browseItemExtras(item)];
  });
}

// プレーヤーのメニューに含まれない「プレイリストに追加」を contextMenuKey の内容から組み立てる
// item は contextMenuKey を持つ（メニューのボタンはその項目にだけ出す）
function browseItemExtras(item) {
  const key = item.contextMenuKey;
  const add = (params) => [{ text: 'プレイリストに追加…', fn: () => addToPlaylist(params, item.text) }];
  const local = key.match(/^LocalMusic:CM\/LocalMusic-(Song|Album)\?(.*)$/);
  if (local) {
    const p = new URLSearchParams(local[2]);
    if (local[1] === 'Song' && p.get('filename')) return add({ songid: p.get('filename') });
    if (local[1] === 'Album' && p.get('album')) return add({ artist: p.get('artist') ?? '', album: p.get('album') });
  }
  const amazon = key.match(/^Amazon:CM\/Amazon-Item\?(.*)$/);
  if (amazon && item.type === 'audio') {
    const url = new URLSearchParams(amazon[1]).get('addURL');
    if (url?.includes('/catalog/tracks/')) return add({ songid: `Amazon:${url}` });
  }
  return [];
}

// ───────────────────────── 曲のメニュー（再生中・キュー・フォルダ共通） ─────────────────────────
// ラジオや外部入力は曲単位の操作ができない
const NON_TRACK_SERVICES = new Set(['Capture', 'TuneIn', 'Airable', 'RadioParadise']);

// song: { title, artist, album, service, fn, isFavourite? }（isFavourite が不明なら追加・削除の両方を出す）
function songMenuEntries(song) {
  const entries = [];
  const local = song.service === 'LocalMusic';
  if (local && song.fn) {
    const q = `fn=${enc(song.fn)}&service=LocalMusic`;
    if (song.isFavourite !== '1') entries.push({ text: 'お気に入りに追加', fn: () => run(`/AddFavourite?${q}`, 'お気に入りに追加しました') });
    if (song.isFavourite !== '0') entries.push({ text: 'お気に入りから削除', fn: () => run(`/DeleteFavourite?${q}`, 'お気に入りから削除しました') });
  }
  if (song.fn && !NON_TRACK_SERVICES.has(song.service)) {
    entries.push({ text: 'プレイリストに追加…', fn: () => addToPlaylist({ songid: song.fn }, song.title) });
  }
  if (local && song.album && song.artist) {
    const key = `LocalMusic:MG/LocalMusic-Album?${new URLSearchParams({ album: song.album, artist: song.artist })}`;
    entries.push({ text: 'アルバムへ移動', fn: () => gotoBrowse(key, song.album) });
  }
  if (local && song.artist) {
    const key = `LocalMusic:MG/LocalMusic-Artist?${new URLSearchParams({ artist: song.artist })}`;
    entries.push({ text: 'アーティストへ移動', fn: () => gotoBrowse(key, song.artist) });
  }
  // Info はライブラリの曲のみ対応（Amazon などは "service method not implemented"）
  if (local) {
    const info = new URLSearchParams({ service: 'LocalMusic' });
    for (const k of ['artist', 'album', 'title']) if (song[k]) info.set(k, song[k]);
    entries.push({ text: '曲情報（last.fm）', fn: () => window.open(`/api/d/Info?${info}`, '_blank', 'noopener') });
    if (song.fn) {
      const tech = new URLSearchParams({ filename: song.fn, service: 'LocalMusic', category: 'technical' });
      entries.push({ text: '技術情報', fn: () => showInfo(song.title, `/Info?${tech}`) });
    }
  }
  return entries;
}

// params: { songid } または { artist, album }
function addToPlaylist(params, title) {
  showMenu(`「${title}」をプレイリストに追加`, async () => {
    const { addToPlaylistOptions: o } = await api(`/AddToPlaylistOptions?${new URLSearchParams(params)}`);
    // requestParameter はエンコード済みの "key=value"。保存先は service、プレイリスト名は name で指定する
    const base = `${o.urlPath}?${asArray(o.requestParameter).join('&')}&service=${enc(o.playlists?.service ?? 'LocalMusic')}`;
    const add = (name) => run(`${base}&name=${enc(name)}`, `「${name}」に追加しました`);
    const names = asArray(o.playlists?.name).map((n) => (typeof n === 'object' ? n['#text'] ?? '' : String(n)));
    const entries = names.map((name) => ({ text: name, fn: () => add(name) }));
    if (o.playlists?.create === '1') {
      entries.push({
        text: '＋ 新しいプレイリスト…',
        fn: () => {
          const name = prompt('新しいプレイリスト名')?.trim();
          if (name) add(name);
        },
      });
    }
    return entries;
  });
}

function gotoBrowse(key, title) {
  browseStack.splice(0, browseStack.length, { key: null, title: 'ソース' }, { key: 'LocalMusic:', title: 'Library' });
  switchTab('browse');
  browseTo({ key, title });
}

function showInfo(title, path) {
  $('infoTitle').textContent = title ?? '';
  $('infoFrame').src = '/api/d' + path;
  $('info').hidden = false;
}
function closeInfo() {
  $('info').hidden = true;
  $('infoFrame').src = 'about:blank';
}
$('infoClose').onclick = closeInfo;
$('info').addEventListener('click', (e) => { if (e.target === $('info')) closeInfo(); });
function closeMenu() { $('menu').hidden = true; menuSeq++; }
$('menuCancel').onclick = closeMenu;
$('menu').addEventListener('click', (e) => { if (e.target === $('menu')) closeMenu(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('menu').hidden || !$('info').hidden) { closeMenu(); closeInfo(); }
  else if (isFullView()) exitFullView();
});

// ───────────────────────── タブ ─────────────────────────
function switchTab(name) {
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('active', b.dataset.tab === name);
  for (const t of ['queue', 'playlists', 'favourites', 'presets', 'browse', 'alarms']) $('tab-' + t).hidden = t !== name;
  // 下までスクロールした状態で切り替えたら、新しいタブの先頭（固定されたタブのバーの直下）まで戻す
  const panelTop = document.querySelector('.panel').getBoundingClientRect().top + window.scrollY;
  const topbarH = document.querySelector('.topbar').offsetHeight;
  if (window.scrollY > panelTop - topbarH) window.scrollTo({ top: panelTop - topbarH });
  if (name === 'playlists' && !pl.current) loadPlaylists();
  if (name === 'favourites') loadFavourites();
  if (name === 'presets' && !presetsLoaded) loadPresets();
  if (name === 'alarms' && !alarmsLoaded) loadAlarms();
  if (name === 'browse' && !browseStack.length) browseTo({ key: null, title: 'ソース' });
  try { localStorage.setItem('tab', name); } catch {}
}
for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => switchTab(b.dataset.tab);

// ヘッダーの高さを CSS に渡す（タブのバー・再生中パネルの固定位置に使う）
new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty('--topbar-h', `${entry.target.offsetHeight}px`);
}).observe(document.querySelector('.topbar'));

// ───────────────────────── 起動 ─────────────────────────
(async () => {
  try {
    const { SyncStatus: s } = await api('/SyncStatus');
    $('deviceName').textContent = s.name ?? 'BluOS';
    $('deviceModel').textContent = [s.brand, s.modelName].filter(Boolean).join(' ');
  } catch {}
})();
let initialTab = 'queue';
try { initialTab = localStorage.getItem('tab') ?? 'queue'; } catch {}
switchTab(initialTab);
if (location.hash === '#nowplaying') setFullView(true);
pollStatus();
