import * as db from './db.js';
import { $, $$, el, toast, MOON_SVG, SUN_SVG, closeSheets } from './ui.js';
import { computeStatus, renderStatus } from './status.js';
import { openChat, reloadChat, setNames } from './chat.js';
import { prepareAvatar, prepareImage } from './media.js';
import { BUILTIN_CARDS } from './seed.js';
import { closeDoodle } from './doodle.js';
import { almanacFor } from './almanac.js';
import { bindDataSettings, refreshDataStatus, maybeRemindBackup, autoPersist } from './backup.js';
import { reloadCards } from './cards.js';
import { resumeNight } from './night.js';

const state = {
  settings: { ...db.DEFAULT_SETTINGS },
  avatarUrls: new Map(),
  statusTimer: 0,
  identityWho: 'me',
};

/* ---------------- 头像库 / 昵称库 ---------------- */

async function normalizeIdentity() {
  const s = state.settings;
  const changed = new Set();

  if (!s.nameMe) { s.nameMe = '我'; changed.add('nameMe'); }
  if (!s.nameMoon) { s.nameMoon = 'moon'; changed.add('nameMoon'); }

  for (const [key, fallback] of [['namesMe', '我'], ['namesMoon', 'moon']]) {
    let list = Array.isArray(s[key]) ? s[key] : [];
    list = list.map((name) => String(name || '').trim()).filter(Boolean).slice(0, 8);
    if (!list.length) list = [fallback];
    const current = key === 'namesMe' ? s.nameMe : s.nameMoon;
    if (!list.includes(current)) list = [current, ...list].slice(0, 8);
    if (JSON.stringify(list) !== JSON.stringify(s[key])) changed.add(key);
    s[key] = list;
  }

  for (const key of ['avatarsMe', 'avatarsMoon']) {
    let list = Array.isArray(s[key]) ? s[key].filter(Boolean).slice(0, 12) : [];
    if (JSON.stringify(list) !== JSON.stringify(s[key])) changed.add(key);
    s[key] = list;
  }
  if (s.avatarMe && !s.avatarsMe.includes(s.avatarMe)) {
    s.avatarsMe = [s.avatarMe, ...s.avatarsMe].slice(0, 12);
    changed.add('avatarsMe');
  }
  if (s.avatarMoon && !s.avatarsMoon.includes(s.avatarMoon)) {
    s.avatarsMoon = [s.avatarMoon, ...s.avatarsMoon].slice(0, 12);
    changed.add('avatarsMoon');
  }

  const walls = ['plain', 'mist', 'dusk', 'paper', 'custom'];
  if (!walls.includes(s.wallpaper)) { s.wallpaper = 'plain'; changed.add('wallpaper'); }
  if (!s.wallpaperMedia) s.wallpaperMedia = null;

  for (const key of changed) await db.setSetting(key, s[key]);
}

function applyIdentityNames() {
  const me = (state.settings.nameMe || '我').trim() || '我';
  const moon = (state.settings.nameMoon || 'moon').trim() || 'moon';
  const labels = $$('#names span');
  if (labels[0]) labels[0].textContent = me;
  if (labels[1]) labels[1].textContent = moon;

  const fallback = $('#avatarMe .avatar-fallback');
  if (fallback) fallback.textContent = me.slice(0, 1) || '我';

  renderNames();
  setNames(me, moon);
}

/* ---------------- 首启：少量内置字卡 + 一句开场 ---------------- */

async function ensureSeed() {
  if (await db.getSetting('seeded')) return;

  const cards = await db.getCards();
  if (!cards.length) {
    for (const [category, text] of BUILTIN_CARDS) {
      await db.addCard({ text, category, builtIn: true });
    }
  }

  const messages = await db.getRecentMessages(1);
  if (!messages.length) {
    const opening = BUILTIN_CARDS.find(([category]) => category === '开场')?.[1] || '我在这儿。';
    await db.addMessage({ role: 'moon', type: 'text', text: opening });
  }

  await db.setSetting('seeded', true);
}

/* ---------------- 时间：日/夜与月亮/太阳 ---------------- */

function isDaytime(date = new Date()) {
  const hour = date.getHours();
  return hour >= 6 && hour < 18;
}

function applyTheme() {
  const mode = state.settings.themeMode || 'auto';
  const theme = mode === 'auto' ? (isDaytime() ? 'light' : 'dark') : mode;
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0e141b' : '#ffffff');
}

function activeSymbol() {
  const mode = state.settings.symbolMode || 'auto';
  if (mode === 'moon') return 'moon';
  if (mode === 'sun') return 'sun';
  return isDaytime() ? 'sun' : 'moon';
}

function updateSymbol() {
  const kind = activeSymbol();
  document.documentElement.dataset.symbol = kind;
  const symbol = $('#symbol');
  if (symbol) symbol.innerHTML = kind === 'sun' ? SUN_SVG : MOON_SVG;
}

/* ---------------- 开场页的一句话 ---------------- */

function refreshOpen() {
  const almanac = almanacFor(new Date());
  $('#openCopy').textContent = almanac.copy;
  $('#openMeta').textContent = almanac.meta;
}

/* ---------------- 头像 ---------------- */

function setAvatarVisual(img, fallback, url) {
  if (url) {
    img.src = url;
    img.hidden = false;
    if (fallback) fallback.hidden = true;
  } else {
    img.removeAttribute('src');
    img.hidden = true;
    if (fallback) fallback.hidden = false;
  }
}

async function avatarURL(mediaId) {
  if (!mediaId) return null;
  if (state.avatarUrls.has(mediaId)) return state.avatarUrls.get(mediaId);
  const record = await db.getMedia(mediaId);
  if (!record) return null;
  const url = URL.createObjectURL(record.blob);
  state.avatarUrls.set(mediaId, url);
  return url;
}

async function renderAvatars() {
  const meUrl = await avatarURL(state.settings.avatarMe);
  const moonUrl = await avatarURL(state.settings.avatarMoon);

  setAvatarVisual($('#avatarMe img'), $('#avatarMe .avatar-fallback'), meUrl);
  setAvatarVisual($('#avatarMoon img'), $('#avatarMoon .avatar-fallback'), moonUrl);
}

function renderNames() {
  $('#names').hidden = !state.settings.showNames;
}

async function renderIdentity() {
  const who = state.identityWho;
  const isMoon = who === 'moon';
  const name = (isMoon ? state.settings.nameMoon : state.settings.nameMe) || (isMoon ? 'moon' : '我');

  for (const button of $$('#identityTabs button')) {
    button.classList.toggle('active', button.dataset.who === who);
  }

  const preview = $('#identityPreview');
  if (preview) preview.className = `avatar ${isMoon ? 'avatar-moon' : 'avatar-me'} tiny`;
  const fallback = $('#identityFallback');
  if (fallback) fallback.textContent = isMoon ? 'moon' : (name.slice(0, 1) || '我');
  const image = $('#identityImg');
  const url = await avatarURL(isMoon ? state.settings.avatarMoon : state.settings.avatarMe);
  if (image) {
    if (url) {
      image.src = url;
      image.hidden = false;
      if (fallback) fallback.hidden = true;
    } else {
      image.removeAttribute('src');
      image.hidden = true;
      if (fallback) fallback.hidden = false;
    }
  }

  if ($('#identityName')) $('#identityName').textContent = name;
  if ($('#identityHint')) {
    $('#identityHint').textContent = isMoon ? 'moon 的头像和昵称' : '你的头像和昵称';
  }

  const libKey = isMoon ? 'avatarsMoon' : 'avatarsMe';
  const selectedId = isMoon ? state.settings.avatarMoon : state.settings.avatarMe;
  const ids = Array.isArray(state.settings[libKey]) ? state.settings[libKey] : [];
  const library = $('#avatarLibrary');
  if (library) {
    const buttons = [];
    for (const id of ids) {
      const button = el('button', {
        type: 'button',
        class: `avatar-choice${id === selectedId ? ' active' : ''}`,
        'aria-label': '选择这个头像',
        onclick: () => selectAvatar(who, id),
      });
      const thumb = el('img', { alt: '' });
      const u = await avatarURL(id);
      if (u) thumb.src = u;
      button.append(thumb);
      buttons.push(button);
    }
    library.replaceChildren(...buttons);
    if (!ids.length) {
      library.append(el('p', { class: 'hint', text: '还没有上传过头像。' }));
    }
  }

  const namesKey = isMoon ? 'namesMoon' : 'namesMe';
  const names = Array.isArray(state.settings[namesKey]) ? state.settings[namesKey] : [];
  const nameList = $('#nameLibrary');
  if (nameList) {
    nameList.replaceChildren(
      ...names.map((item) =>
        el('button', {
          type: 'button',
          class: `chip${item === name ? ' active' : ''}`,
          text: item,
          onclick: () => selectName(who, item),
        })
      )
    );
  }

  if ($('#nameNew')) {
    $('#nameNew').placeholder = isMoon ? '给 moon 写个昵称' : '写一个新昵称';
  }
  if ($('#showNames')) $('#showNames').checked = !!state.settings.showNames;
}

async function selectAvatar(who, mediaId) {
  const key = who === 'moon' ? 'avatarMoon' : 'avatarMe';
  state.settings[key] = mediaId;
  await db.setSetting(key, mediaId);
  await renderAvatars();
  await renderIdentity();
  toast('换好了');
}

async function addAvatar(who, mediaId) {
  const libKey = who === 'moon' ? 'avatarsMoon' : 'avatarsMe';
  const list = Array.isArray(state.settings[libKey]) ? [...state.settings[libKey]] : [];
  const next = [mediaId, ...list.filter((id) => id !== mediaId)].slice(0, 12);
  state.settings[libKey] = next;
  await db.setSetting(libKey, next);
  await selectAvatar(who, mediaId);
}

async function selectName(who, name) {
  const clean = String(name || '').trim().slice(0, 12);
  if (!clean) return;
  const key = who === 'moon' ? 'nameMoon' : 'nameMe';
  state.settings[key] = clean;
  await db.setSetting(key, clean);
  applyIdentityNames();
  await renderIdentity();
}

async function addName() {
  const input = $('#nameNew');
  const name = input.value.trim().slice(0, 12);
  if (!name) {
    input.focus();
    return;
  }

  const who = state.identityWho;
  const key = who === 'moon' ? 'namesMoon' : 'namesMe';
  const list = Array.isArray(state.settings[key]) ? [...state.settings[key]] : [];
  if (!list.includes(name)) {
    if (list.length >= 8) {
      toast('昵称库最多 8 个');
      return;
    }
    list.push(name);
    state.settings[key] = list;
    await db.setSetting(key, list);
  }

  input.value = '';
  await selectName(who, name);
}

async function applyWallpaper() {
  const chat = $('#chat');
  if (!chat) return;
  const wall = state.settings.wallpaper || 'plain';

  chat.style.backgroundImage = '';
  chat.style.backgroundSize = '';
  chat.style.backgroundPosition = '';
  chat.style.backgroundRepeat = '';
  chat.dataset.wallpaper = wall;

  if (wall === 'custom' && state.settings.wallpaperMedia) {
    const url = await avatarURL(state.settings.wallpaperMedia);
    if (url) {
      chat.style.backgroundImage = `linear-gradient(var(--wallpaper-veil), var(--wallpaper-veil)), url("${url}")`;
      chat.style.backgroundSize = 'cover';
      chat.style.backgroundPosition = 'center';
      chat.style.backgroundRepeat = 'no-repeat';
    } else {
      chat.dataset.wallpaper = 'plain';
    }
  }
}

function renderWallpaper() {
  const wall = state.settings.wallpaper || 'plain';
  for (const button of $$('#wallpaperPresets button')) {
    button.classList.toggle('active', button.dataset.wall === wall);
  }
  const reset = $('#wallpaperReset');
  if (reset) reset.hidden = wall === 'plain';
}

async function setWallpaper(value) {
  state.settings.wallpaper = value;
  state.settings.wallpaperMedia = null;
  await db.setSetting('wallpaper', value);
  await db.setSetting('wallpaperMedia', null);
  await applyWallpaper();
  renderWallpaper();
}

async function uploadWallpaper(file) {
  if (!file) return;
  try {
    const prepared = await prepareImage(file);
    const mediaId = await db.putMedia(prepared.blob, {
      mime: prepared.blob.type,
      width: prepared.width,
      height: prepared.height,
      kind: 'wallpaper',
    });
    state.settings.wallpaper = 'custom';
    state.settings.wallpaperMedia = mediaId;
    await db.setSetting('wallpaper', 'custom');
    await db.setSetting('wallpaperMedia', mediaId);
    await applyWallpaper();
    renderWallpaper();
    toast('壁纸换好了');
  } catch (error) {
    toast(error.message || '这张图用不了');
  }
}

/* ---------------- 状态 ---------------- */

async function refreshStatus() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const todayCount = await db.countMessagesSince(start.getTime());
  const status = computeStatus(Date.now(), todayCount);
  renderStatus($('#status'), status);
}

/* ---------------- 设置 ---------------- */

function syncSettingsUI() {
  for (const button of $$('#themeMode button')) {
    button.classList.toggle('active', button.dataset.mode === state.settings.themeMode);
  }
  for (const button of $$('#symbolMode button')) {
    button.classList.toggle('active', button.dataset.mode === state.settings.symbolMode);
  }
  for (const button of $$('#replySpeed button')) {
    button.classList.toggle('active', button.dataset.mode === state.settings.replySpeed);
  }
  for (const button of $$('#replyCount button')) {
    button.classList.toggle('active', button.dataset.mode === state.settings.replyCount);
  }
  $('#showNames').checked = !!state.settings.showNames;
}

function openSettings() {
  syncSettingsUI();
  renderAvatars();
  renderIdentity();
  renderWallpaper();
  refreshDataStatus();
  $('#settingsSheet').hidden = false;
  $('#settingsBackdrop').hidden = false;
}

function closeSettings() {
  $('#settingsSheet').hidden = true;
  $('#settingsBackdrop').hidden = true;
}

async function softReload() {
  state.settings = await db.getAllSettings();
  await normalizeIdentity();
  applyTheme();
  updateSymbol();
  refreshOpen();
  applyIdentityNames();
  await renderAvatars();
  await applyWallpaper();
  renderWallpaper();
  await refreshStatus();
  await reloadChat();
  await reloadCards();
}

function bindSettings() {
  $('#openSettings').addEventListener('click', openSettings);
  $('#settingsClose').addEventListener('click', closeSettings);
  $('#settingsBackdrop').addEventListener('click', closeSettings);

  for (const button of $$('#themeMode button')) {
    button.addEventListener('click', async () => {
      state.settings.themeMode = button.dataset.mode;
      await db.setSetting('themeMode', button.dataset.mode);
      syncSettingsUI();
      applyTheme();
    });
  }

  for (const button of $$('#symbolMode button')) {
    button.addEventListener('click', async () => {
      state.settings.symbolMode = button.dataset.mode;
      await db.setSetting('symbolMode', button.dataset.mode);
      syncSettingsUI();
      updateSymbol();
    });
  }

  $('#showNames').addEventListener('change', async (event) => {
    state.settings.showNames = event.target.checked;
    await db.setSetting('showNames', state.settings.showNames);
    renderNames();
  });

  for (const button of $$('#replySpeed button')) {
    button.addEventListener('click', async () => {
      state.settings.replySpeed = button.dataset.mode;
      await db.setSetting('replySpeed', button.dataset.mode);
      syncSettingsUI();
    });
  }

  for (const button of $$('#replyCount button')) {
    button.addEventListener('click', async () => {
      state.settings.replyCount = button.dataset.mode;
      await db.setSetting('replyCount', button.dataset.mode);
      syncSettingsUI();
    });
  }

  for (const button of $$('#identityTabs button')) {
    button.addEventListener('click', () => {
      state.identityWho = button.dataset.who === 'moon' ? 'moon' : 'me';
      renderIdentity();
    });
  }

  $('#avatarUpload').addEventListener('click', () => {
    const input = $('#avatarFile');
    input.value = '';
    input.click();
  });

  $('#avatarFile').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const blob = await prepareAvatar(file);
      const mediaId = await db.putMedia(blob, { mime: blob.type, kind: 'avatar' });
      await addAvatar(state.identityWho, mediaId);
    } catch (error) {
      toast(error.message || '这张图用不了');
    }
  });

  $('#nameAdd').addEventListener('click', addName);
  $('#nameNew').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addName();
    }
  });

  for (const button of $$('#wallpaperPresets button')) {
    button.addEventListener('click', () => setWallpaper(button.dataset.wall));
  }
  $('#wallpaperUpload').addEventListener('click', () => {
    const input = $('#wallpaperFile');
    input.value = '';
    input.click();
  });
  $('#wallpaperFile').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    await uploadWallpaper(file);
  });
  $('#wallpaperReset').addEventListener('click', () => setWallpaper('plain'));
}

function pickAvatar(kind) {
  // 有些手机浏览器要求 file input 在文档里才肯打开选择器
  const input = el('input', { type: 'file', accept: 'image/*' });
  input.style.display = 'none';
  document.body.append(input);

  const cleanup = () => input.remove();

  input.addEventListener('cancel', cleanup);
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) {
      cleanup();
      return;
    }
    try {
      const blob = await prepareAvatar(file);
      const mediaId = await db.putMedia(blob, { mime: blob.type, kind: 'avatar' });
      await addAvatar(kind, mediaId);
    } catch (error) {
      toast(error.message || '这张图用不了');
    } finally {
      cleanup();
    }
  });

  input.click();
}

/* ---------------- 打开聊天 / 状态数字 ---------------- */

function bindOpen() {
  $('#openView').addEventListener('click', () => openChat());
  $('#openView').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openChat();
    }
  });

  $('#avatarMe').addEventListener('click', () => pickAvatar('me'));
  $('#avatarMoon').addEventListener('click', () => pickAvatar('moon'));

  $('#status').addEventListener('click', () => {
    const node = $('#status');
    node.classList.toggle('reveal');
    clearTimeout(state.statusTimer);
    if (node.classList.contains('reveal')) {
      state.statusTimer = setTimeout(() => node.classList.remove('reveal'), 8000);
    }
  });
}

/* ---------------- 启动 ---------------- */

function bindGlobal() {
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!$('#doodle').hidden) closeDoodle();
    else if (!$('#sheet').hidden || !$('#settingsSheet').hidden) closeSheets();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    applyTheme();
    updateSymbol();
    refreshOpen();
    refreshStatus();
  });

  document.addEventListener('moon:pick-avatar', (event) => {
    pickAvatar(event.detail === 'moon' ? 'moon' : 'me');
  });

  document.addEventListener('moon:message', () => refreshStatus());
  document.addEventListener('moon:chat-open', () => refreshStatus());

  document.addEventListener('moon:home', () => {
    applyTheme();
    updateSymbol();
    refreshOpen();
    refreshStatus();
  });

  setInterval(() => {
    applyTheme();
    updateSymbol();
    refreshOpen();
  }, 60_000);

  setInterval(() => {
    refreshStatus();
  }, 5 * 60_000);
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const forced = new URLSearchParams(location.search).has('sw');
  if (local && !forced) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

async function boot() {
  try {
    await db.openDB();
    state.settings = await db.getAllSettings();
    await normalizeIdentity();

    if (db.isMemoryMode()) {
      const hint = $('#dataHint');
      if (hint) {
        hint.textContent = '现在是用预览方式打开的，聊天和图片不会保存；从 http 打开或安装后才会留在本机。';
      }
      toast('预览方式打开：这次记录不会保存', 3600);
    }

    await ensureSeed();

    applyTheme();
    updateSymbol();
    refreshOpen();
    applyIdentityNames();
    await renderAvatars();
    await applyWallpaper();
    await refreshStatus();
    await resumeNight();

    bindOpen();
    bindSettings();
    bindDataSettings();
    document.addEventListener('moon:data-restored', () => {
      softReload().catch(() => {});
    });
    bindGlobal();
    registerSW();

    setTimeout(() => autoPersist(), 1200);
    setTimeout(() => maybeRemindBackup(), 1800);



  } catch (error) {
    console.error(error);
    toast('数据没有打开，刷新试试');
  }
}

boot();
