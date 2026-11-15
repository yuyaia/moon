// 本地数据：IndexedDB。聊天记录与图片/涂鸦分开存，图片只存 id 引用。
// 有些打开方式（file:// 的单文件预览、隐私模式）拿不到 IndexedDB，
// 这时退回同接口的内存实现：能看能用，但这次关掉就没了。

const DB_NAME = 'moon';
const DB_VERSION = 2;

let _db = null;
let memMode = false;

const mem = {
  messages: [],
  media: new Map(),
  cards: [],
  collections: [],
  tracks: [],
  settings: new Map(),
};

const byCreatedAt = (a, b) => a.createdAt - b.createdAt;

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function isMemoryMode() {
  return memMode;
}

export function openDB() {
  if (memMode) return Promise.resolve(null);
  if (_db) return Promise.resolve(_db);

  if (typeof indexedDB === 'undefined' || !indexedDB) {
    memMode = true;
    return Promise.resolve(null);
  }

  try {
    if (new URLSearchParams(location.search).has('memory')) {
      memMode = true;
      return Promise.resolve(null);
    }
  } catch { /* 没有 location 的环境 */ }

  return new Promise((resolve) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      memMode = true;
      resolve(null);
      return;
    }

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('messages')) {
        const messages = db.createObjectStore('messages', { keyPath: 'id' });
        messages.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('media')) {
        db.createObjectStore('media', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('cards')) {
        const cards = db.createObjectStore('cards', { keyPath: 'id' });
        cards.createIndex('createdAt', 'createdAt');
        cards.createIndex('category', 'category');
      }
      if (!db.objectStoreNames.contains('collections')) {
        const collections = db.createObjectStore('collections', { keyPath: 'id' });
        collections.createIndex('collectedAt', 'collectedAt');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('tracks')) {
        const tracks = db.createObjectStore('tracks', { keyPath: 'id' });
        tracks.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => { _db.close(); _db = null; };
      resolve(_db);
    };
    req.onerror = () => {
      memMode = true;
      resolve(null);
    };
  });
}

async function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function readAll(storeName, indexName = null) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readonly');
  const store = indexName ? tx.objectStore(storeName).index(indexName) : tx.objectStore(storeName);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ---------------- 消息 ---------------- */

export async function addMessage({
  role,
  type = 'text',
  text = '',
  mediaId = null,
  width = 0,
  height = 0,
  quote = null,
  bottle = null,
}) {
  const msg = {
    id: uuid(),
    role,
    type,
    text,
    mediaId,
    width,
    height,
    quote,
    bottle,
    createdAt: Date.now(),
  };

  if (memMode) {
    mem.messages.push(msg);
    return msg;
  }

  const db = await openDB();
  const tx = db.transaction('messages', 'readwrite');
  tx.objectStore('messages').add(msg);
  await done(tx);
  return msg;
}

export async function getRecentMessages(limit = 30) {
  if (memMode) {
    return mem.messages.slice().sort(byCreatedAt).slice(-limit);
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readonly');
    const index = tx.objectStore('messages').index('createdAt');
    const out = [];
    const req = index.openCursor(null, 'prev');
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || out.length >= limit) {
        resolve(out.reverse());
        return;
      }
      out.push(cursor.value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getOldestMessage() {
  if (memMode) return mem.messages.slice().sort(byCreatedAt)[0] || null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readonly');
    const req = tx.objectStore('messages').index('createdAt').openCursor(null, 'next');
    req.onsuccess = () => resolve(req.result ? req.result.value : null);
    req.onerror = () => reject(req.error);
  });
}

export async function getMessagesBefore(createdAt, limit = 30) {
  if (memMode) {
    return mem.messages
      .filter((m) => m.createdAt < createdAt)
      .sort(byCreatedAt)
      .slice(-limit);
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readonly');
    const index = tx.objectStore('messages').index('createdAt');
    const out = [];
    const range = IDBKeyRange.upperBound(createdAt, true);
    const req = index.openCursor(range, 'prev');
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || out.length >= limit) {
        resolve(out.reverse());
        return;
      }
      out.push(cursor.value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

// 搜索定位用：取某条消息前后各若干条。
export async function getMessagesAround(createdAt, before = 30, after = 20) {
  if (memMode) {
    const sorted = mem.messages.slice().sort(byCreatedAt);
    return [
      ...sorted.filter((m) => m.createdAt <= createdAt).slice(-before),
      ...sorted.filter((m) => m.createdAt > createdAt).slice(0, after),
    ];
  }
  const db = await openDB();
  const tx = db.transaction('messages', 'readonly');
  const index = tx.objectStore('messages').index('createdAt');

  const prev = await new Promise((resolve, reject) => {
    const out = [];
    const req = index.openCursor(IDBKeyRange.upperBound(createdAt), 'prev');
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || out.length >= before) return resolve(out.reverse());
      out.push(cursor.value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });

  const next = await new Promise((resolve, reject) => {
    const out = [];
    const req = index.openCursor(IDBKeyRange.lowerBound(createdAt, true), 'next');
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || out.length >= after) return resolve(out);
      out.push(cursor.value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });

  return [...prev, ...next];
}

export async function getMessagesAfter(createdAt, limit = 30) {
  if (memMode) {
    return mem.messages
      .filter((m) => m.createdAt > createdAt)
      .sort(byCreatedAt)
      .slice(0, limit);
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readonly');
    const index = tx.objectStore('messages').index('createdAt');
    const out = [];
    const req = index.openCursor(IDBKeyRange.lowerBound(createdAt, true), 'next');
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor || out.length >= limit) {
        resolve(out);
        return;
      }
      out.push(cursor.value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getMessage(id) {
  if (memMode) {
    return mem.messages.find((m) => m.id === id) || null;
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readonly');
    const req = tx.objectStore('messages').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function updateMessage(id, patch) {
  if (memMode) {
    const msg = mem.messages.find((m) => m.id === id);
    if (!msg) return null;
    Object.assign(msg, patch);
    return msg;
  }
  const existing = await getMessage(id);
  if (!existing) return null;
  const updated = { ...existing, ...patch, id };
  const db = await openDB();
  const tx = db.transaction('messages', 'readwrite');
  tx.objectStore('messages').put(updated);
  await done(tx);
  return updated;
}

export async function deleteMessage(id) {
  if (memMode) {
    mem.messages = mem.messages.filter((m) => m.id !== id);
    return;
  }
  const db = await openDB();
  const tx = db.transaction('messages', 'readwrite');
  tx.objectStore('messages').delete(id);
  await done(tx);
}

export async function searchMessages(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  if (memMode) {
    const sorted = mem.messages.slice().sort(byCreatedAt);
    const out = [];
    for (let i = sorted.length - 1; i >= 0 && out.length < 80; i--) {
      const m = sorted[i];
      const hay = `${m.text || ''} ${m.quote?.text || ''}`.toLowerCase();
      if (hay.includes(q)) out.push(m);
    }
    return out;
  }

  const all = await readAll('messages', 'createdAt');
  const out = [];
  for (let i = all.length - 1; i >= 0 && out.length < 80; i--) {
    const m = all[i];
    const hay = `${m.text || ''} ${m.quote?.text || ''}`.toLowerCase();
    if (hay.includes(q)) out.push(m);
  }
  return out;
}

export async function countMessagesSince(ts) {
  if (memMode) {
    return mem.messages.filter((m) => m.createdAt >= ts).length;
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('messages', 'readonly');
    const index = tx.objectStore('messages').index('createdAt');
    const req = index.count(IDBKeyRange.lowerBound(ts));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/* ---------------- 整库导出 / 恢复 ---------------- */

export async function getAllMessages() {
  if (memMode) return mem.messages.slice().sort(byCreatedAt);
  return readAll('messages', 'createdAt');
}

export async function getAllMedia() {
  if (memMode) return [...mem.media.values()];
  return readAll('media');
}

export async function getAllData() {
  const [messages, media, cards, collections, tracks, settings] = await Promise.all([
    getAllMessages(),
    getAllMedia(),
    getCards(),
    getCollections(),
    getTracks(),
    getAllSettings(),
  ]);
  return { messages, media, cards, collections, tracks, settings };
}

export async function replaceAllData({
  messages = [],
  media = [],
  cards = [],
  collections = [],
  tracks = [],
  settings = {},
} = {}) {
  const safeMessages = messages.slice().sort(byCreatedAt);
  const safeCards = cards.slice().sort(byCreatedAt);
  const safeCollections = collections.slice().sort((a, b) => a.collectedAt - b.collectedAt);
  const safeTracks = tracks.slice().sort(byCreatedAt);

  if (memMode) {
    mem.messages = safeMessages;
    mem.media = new Map(media.map((item) => [item.id, item]));
    mem.cards = safeCards;
    mem.collections = safeCollections;
    mem.tracks = safeTracks;
    mem.settings = new Map(Object.entries(settings));
    return;
  }

  const db = await openDB();
  const tx = db.transaction(['messages', 'media', 'cards', 'collections', 'tracks', 'settings'], 'readwrite');
  for (const name of ['messages', 'media', 'cards', 'collections', 'tracks', 'settings']) {
    tx.objectStore(name).clear();
  }
  for (const item of safeMessages) tx.objectStore('messages').put(item);
  for (const item of media) tx.objectStore('media').put(item);
  for (const item of safeCards) tx.objectStore('cards').put(item);
  for (const item of safeCollections) tx.objectStore('collections').put(item);
  for (const item of safeTracks) tx.objectStore('tracks').put(item);
  for (const [key, value] of Object.entries(settings)) {
    tx.objectStore('settings').put({ key, value });
  }
  await done(tx);
}

export async function clearAllData() {
  if (memMode) {
    mem.messages = [];
    mem.media.clear();
    mem.cards = [];
    mem.collections = [];
    mem.tracks = [];
    mem.settings.clear();
    return;
  }
  const db = await openDB();
  const tx = db.transaction(['messages', 'media', 'cards', 'collections', 'tracks', 'settings'], 'readwrite');
  for (const name of ['messages', 'media', 'cards', 'collections', 'tracks', 'settings']) {
    tx.objectStore(name).clear();
  }
  await done(tx);
}

/* ---------------- 图片 / 涂鸦 ---------------- */

export async function putMedia(blob, meta = {}) {
  const record = { id: uuid(), blob, ...meta, createdAt: Date.now() };
  if (memMode) {
    mem.media.set(record.id, record);
    return record.id;
  }
  const db = await openDB();
  const tx = db.transaction('media', 'readwrite');
  tx.objectStore('media').put(record);
  await done(tx);
  return record.id;
}

export async function getMedia(id) {
  if (!id) return null;
  if (memMode) return mem.media.get(id) || null;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('media', 'readonly');
    const req = tx.objectStore('media').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

/* ---------------- 字卡 ---------------- */

export async function getCards() {
  if (memMode) return mem.cards.slice().sort(byCreatedAt);
  const cards = await readAll('cards', 'createdAt');
  return cards.sort((a, b) => a.createdAt - b.createdAt);
}

export async function addCard({
  text = '',
  category = '日常',
  builtIn = false,
  type = 'text',
  mediaId = null,
  width = 0,
  height = 0,
  sourceUrl = null,
  sourceKey = null,
}) {
  const card = {
    id: uuid(),
    text: String(text || '').trim(),
    category,
    builtIn,
    type,
    mediaId,
    width,
    height,
    sourceUrl,
    sourceKey,
    createdAt: Date.now(),
  };
  if (memMode) {
    mem.cards.push(card);
    return card;
  }
  const db = await openDB();
  const tx = db.transaction('cards', 'readwrite');
  tx.objectStore('cards').add(card);
  await done(tx);
  return card;
}

export async function updateCard(id, patch) {
  if (memMode) {
    const card = mem.cards.find((c) => c.id === id);
    if (!card) return null;
    Object.assign(card, patch);
    return card;
  }
  const db = await openDB();
  const cards = await readAll('cards');
  const existing = cards.find((c) => c.id === id);
  if (!existing) return null;
  const updated = { ...existing, ...patch, id };
  const tx = db.transaction('cards', 'readwrite');
  tx.objectStore('cards').put(updated);
  await done(tx);
  return updated;
}

export async function deleteCard(id) {
  if (memMode) {
    mem.cards = mem.cards.filter((c) => c.id !== id);
    return;
  }
  const db = await openDB();
  const tx = db.transaction('cards', 'readwrite');
  tx.objectStore('cards').delete(id);
  await done(tx);
}

export async function deleteMedia(id) {
  if (!id) return;
  if (memMode) {
    mem.media.delete(id);
    return;
  }
  const db = await openDB();
  const tx = db.transaction('media', 'readwrite');
  tx.objectStore('media').delete(id);
  await done(tx);
}

/* ---------------- 音乐库 ---------------- */

export async function getTracks() {
  if (memMode) return mem.tracks.slice().sort(byCreatedAt);
  return readAll('tracks', 'createdAt');
}

export async function addTrack({
  title = '',
  artist = '',
  url = null,
  mediaId = null,
  mime = '',
  size = 0,
  duration = 0,
  source = 'url',
}) {
  const track = {
    id: uuid(),
    title: String(title || '').trim() || '未命名音频',
    artist: String(artist || '').trim(),
    url,
    mediaId,
    mime,
    size,
    duration,
    source,
    createdAt: Date.now(),
  };
  if (memMode) {
    mem.tracks.push(track);
    return track;
  }
  const db = await openDB();
  const tx = db.transaction('tracks', 'readwrite');
  tx.objectStore('tracks').add(track);
  await done(tx);
  return track;
}

export async function updateTrack(id, patch) {
  if (memMode) {
    const track = mem.tracks.find((item) => item.id === id);
    if (!track) return null;
    Object.assign(track, patch);
    return track;
  }
  const db = await openDB();
  const all = await readAll('tracks');
  const existing = all.find((item) => item.id === id);
  if (!existing) return null;
  const updated = { ...existing, ...patch, id };
  const tx = db.transaction('tracks', 'readwrite');
  tx.objectStore('tracks').put(updated);
  await done(tx);
  return updated;
}

export async function deleteTrack(id) {
  if (memMode) {
    mem.tracks = mem.tracks.filter((item) => item.id !== id);
    return;
  }
  const db = await openDB();
  const tx = db.transaction('tracks', 'readwrite');
  tx.objectStore('tracks').delete(id);
  await done(tx);
}

/* ---------------- 收藏（给后面的漂流瓶用） ---------------- */

export async function addCollection({ text, messageId, role }) {
  const item = {
    id: uuid(),
    text,
    messageId,
    role,
    collectedAt: Date.now(),
  };
  if (memMode) {
    mem.collections.push(item);
    return item;
  }
  const db = await openDB();
  const tx = db.transaction('collections', 'readwrite');
  tx.objectStore('collections').add(item);
  await done(tx);
  return item;
}

export async function getCollections() {
  if (memMode) return mem.collections.slice().sort((a, b) => a.collectedAt - b.collectedAt);
  return readAll('collections', 'collectedAt');
}

export async function getBottleMessages(limit = 30) {
  const all = await getAllMessages();
  return all
    .filter((message) => message.type === 'bottle')
    .slice(-limit)
    .reverse();
}

export async function deleteCollection(id) {
  if (memMode) {
    mem.collections = mem.collections.filter((item) => item.id !== id);
    return;
  }
  const db = await openDB();
  const tx = db.transaction('collections', 'readwrite');
  tx.objectStore('collections').delete(id);
  await done(tx);
}

/* ---------------- 设置 ---------------- */

export const DEFAULT_SETTINGS = {
  themeMode: 'light',       // light | auto | dark
  themeDarkStart: '22:00',  // auto 模式下入夜
  themeDarkEnd: '06:00',    // auto 模式下天亮
  symbolMode: 'auto',       // auto | moon | sun
  replySpeed: 'natural',    // 旧字段，保留兼容
  replyCount: '1',          // 旧字段，保留兼容
  replyDelayMin: 0.85,      // 秒
  replyDelayMax: 2.3,       // 秒
  replyCountMin: 1,         // 句
  replyCountMax: 1,         // 句
  showNames: false,
  nameMe: '我',
  nameMoon: 'moon',
  namesMe: [],
  namesMoon: [],
  avatarsMe: [],            // 头像库：媒体 id
  avatarsMoon: [],
  avatarMe: null,           // 当前选中的 media id
  avatarMoon: null,
  wallpaper: 'plain',       // plain | mist | dusk | paper | custom
  wallpaperMedia: null,
  nightSleep: '23:30',
  nightWake: '07:30',
  nightActive: false,
  nightWakeAt: 0,
  nightStartedAt: 0,
  nightLine: '',
  seeded: false,
  recentReplies: [],        // 最近用过的字卡，避免连续重复
  recentBottles: [],        // 最近捞过的收藏，避免连续同一句
};

export async function getSetting(key) {
  if (memMode) {
    return mem.settings.has(key) ? mem.settings.get(key) : DEFAULT_SETTINGS[key];
  }
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const req = tx.objectStore('settings').get(key);
    req.onsuccess = () => {
      const row = req.result;
      resolve(row ? row.value : DEFAULT_SETTINGS[key]);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function setSetting(key, value) {
  if (memMode) {
    mem.settings.set(key, value);
    return;
  }
  const db = await openDB();
  const tx = db.transaction('settings', 'readwrite');
  tx.objectStore('settings').put({ key, value });
  await done(tx);
}

export async function getAllSettings() {
  if (memMode) {
    const out = { ...DEFAULT_SETTINGS };
    for (const [key, value] of mem.settings) out[key] = value;
    return out;
  }
  const rows = await readAll('settings');
  const out = { ...DEFAULT_SETTINGS };
  for (const row of rows) out[row.key] = row.value;
  return out;
}
