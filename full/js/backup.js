import * as db from './db.js';
import { $, toast, openActionSheet, formatFull } from './ui.js';

const FORMAT = 'moon-backup';
const VERSION = 1;
const ITERATIONS = 150000;
const DAY = 86400000;
const BOOKKEEPING = ['installedAt', 'lastExportAt', 'cardsAtLastExport', 'exportReminderAt'];

let bound = false;
let pendingEnvelope = null;
let pendingName = '';
let pendingData = null;

/* ---------------- 小工具 ---------------- */

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = value / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n >= 10 ? 0 : 1)} ${units[i]}`;
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  return bytesToBase64(new Uint8Array(buffer));
}

function base64ToBlob(value, mime) {
  return new Blob([base64ToBytes(value)], { type: mime || 'application/octet-stream' });
}

function webcrypto() {
  return typeof crypto !== 'undefined' ? crypto : null;
}

async function deriveKey(password, salt, iterations) {
  const c = webcrypto();
  if (!c?.subtle) throw new Error('这个浏览器不支持加密备份');
  const material = await c.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return c.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function normalizeData(input) {
  if (!input || typeof input !== 'object') throw new Error('备份内容不完整');
  const data = {
    messages: Array.isArray(input.messages) ? input.messages : [],
    cards: Array.isArray(input.cards) ? input.cards : [],
    media: Array.isArray(input.media) ? input.media : [],
    collections: Array.isArray(input.collections) ? input.collections : [],
    settings: input.settings && typeof input.settings === 'object' ? input.settings : {},
    createdAt: Number(input.createdAt) || Date.now(),
  };
  return data;
}

export function assertEnvelope(envelope) {
  if (!envelope || envelope.format !== FORMAT) throw new Error('不是 moon 的备份文件');
  if (Number(envelope.version) > VERSION) throw new Error('备份版本比现在新，先更新 moon');
  return envelope;
}

/* ---------------- 采集 / 加密 / 恢复 ---------------- */

export async function collectBackup(onProgress) {
  const [messages, media, cards, collections, settings] = await Promise.all([
    db.getAllMessages(),
    db.getAllMedia(),
    db.getCards(),
    db.getCollections(),
    db.getAllSettings(),
  ]);

  const safeSettings = { ...settings };
  for (const key of BOOKKEEPING) delete safeSettings[key];

  const mediaOut = [];
  for (let i = 0; i < media.length; i += 1) {
    const item = media[i];
    let data = '';
    if (item.blob) {
      try {
        data = await blobToBase64(item.blob);
      } catch { /* 单张读不出就留空，不拖垮整个备份 */ }
    }
    mediaOut.push({
      id: item.id,
      mime: item.mime || item.blob?.type || '',
      width: item.width || 0,
      height: item.height || 0,
      createdAt: item.createdAt || 0,
      sourceUrl: item.sourceUrl || null,
      sourceKey: item.sourceKey || null,
      data,
    });
    onProgress?.(i + 1, media.length);
  }

  return {
    createdAt: Date.now(),
    messages,
    cards,
    media: mediaOut,
    collections,
    settings: safeSettings,
  };
}

export async function encryptBackup(data, password) {
  const c = webcrypto();
  if (!c?.subtle) throw new Error('这个浏览器不支持加密备份');
  if (!password || password.length < 4) throw new Error('口令至少 4 位');

  const salt = c.getRandomValues(new Uint8Array(16));
  const iv = c.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const plain = new TextEncoder().encode(JSON.stringify(data));
  const cipher = await c.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);

  return {
    format: FORMAT,
    version: VERSION,
    createdAt: data.createdAt || Date.now(),
    encrypted: true,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(cipher)),
  };
}

export async function decryptBackup(envelope, password) {
  assertEnvelope(envelope);

  if (!envelope.encrypted) {
    const raw = typeof envelope.data === 'string'
      ? JSON.parse(envelope.data)
      : envelope.data;
    return normalizeData(raw?.data || raw);
  }

  if (!password) throw new Error('先输入备份口令');
  const c = webcrypto();
  if (!c?.subtle) throw new Error('这个浏览器不支持解密备份');

  const iterations = Math.min(2000000, Math.max(10000, Number(envelope.iterations) || ITERATIONS));
  const salt = base64ToBytes(envelope.salt);
  const iv = base64ToBytes(envelope.iv);
  const key = await deriveKey(password, salt, iterations);

  let plain;
  try {
    plain = await c.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      base64ToBytes(envelope.data)
    );
  } catch {
    throw new Error('口令不对，或者备份文件坏了');
  }

  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error('备份内容读不出来');
  }
  return normalizeData(parsed?.data || parsed);
}

export async function restoreBackup(data) {
  const safe = normalizeData(data);
  const media = safe.media.map((item) => {
    let blob = null;
    if (item.data) {
      try {
        blob = base64ToBlob(item.data, item.mime);
      } catch { /* 留空 */ }
    }
    return { ...item, blob, data: undefined };
  });

  await db.replaceAllData({
    messages: safe.messages,
    cards: safe.cards,
    collections: safe.collections,
    settings: safe.settings,
    media,
  });

  const now = Date.now();
  let oldest = now;
  for (const message of safe.messages) {
    if (message.createdAt && message.createdAt < oldest) oldest = message.createdAt;
  }

  await db.setSetting('installedAt', oldest);
  await db.setSetting('lastExportAt', now);
  await db.setSetting('cardsAtLastExport', safe.cards.length);
  await db.setSetting('exportReminderAt', 0);
  await db.setSetting('seeded', true);

  return {
    messages: safe.messages.length,
    cards: safe.cards.length,
    media: media.length,
    collections: safe.collections.length,
  };
}

export async function exportBackup(password, onProgress) {
  const data = await collectBackup(onProgress);
  const envelope = await encryptBackup(data, password);
  const json = JSON.stringify(envelope);
  const blob = new Blob([json], { type: 'application/json' });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `moon-backup-${stamp}.json`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);

  await db.setSetting('lastExportAt', Date.now());
  await db.setSetting('cardsAtLastExport', data.cards.length);
  await db.setSetting('exportReminderAt', 0);

  return {
    filename,
    bytes: blob.size,
    counts: {
      messages: data.messages.length,
      cards: data.cards.length,
      media: data.media.length,
      collections: data.collections.length,
    },
  };
}

/* ---------------- 存储状态 / 提醒 ---------------- */

export async function storageState() {
  const memory = db.isMemoryMode();
  let persisted = false;
  let usage = 0;
  let quota = 0;

  if (!memory && typeof navigator !== 'undefined' && navigator.storage) {
    try {
      if (navigator.storage.persisted) persisted = await navigator.storage.persisted();
    } catch { /* ignore */ }
    try {
      if (navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        usage = estimate.usage || 0;
        quota = estimate.quota || 0;
      }
    } catch { /* ignore */ }
  }

  return { memory, persisted, usage, quota };
}

export async function requestPersist(showToast = true) {
  if (db.isMemoryMode()) {
    if (showToast) toast('预览方式打开，不能申请持久存储', 2600);
    return false;
  }
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    if (showToast) toast('这个浏览器不支持持久存储', 2600);
    return false;
  }
  let ok = false;
  try {
    ok = await navigator.storage.persist();
  } catch {
    ok = false;
  }
  if (showToast) {
    toast(ok ? '已留在本机' : '浏览器没有同意，仍可能被清理', 3000);
  }
  refreshDataStatus();
  return ok;
}

export async function autoPersist() {
  if (db.isMemoryMode()) return;
  try {
    if (!navigator.storage?.persisted) return;
    if (await navigator.storage.persisted()) return;
    await navigator.storage.persist?.();
  } catch { /* ignore */ }
}

export async function ensureBackupMeta() {
  if (db.isMemoryMode()) return;
  const settings = await db.getAllSettings();
  if (!settings.installedAt) {
    await db.setSetting('installedAt', Date.now());
  }
  if (!settings.cardsAtLastExport) {
    const cards = await db.getCards();
    await db.setSetting('cardsAtLastExport', cards.length);
  }
}

export async function backupDueInfo() {
  const [settings, cards, oldest] = await Promise.all([
    db.getAllSettings(),
    db.getCards(),
    db.getOldestMessage(),
  ]);
  const now = Date.now();
  const base = settings.lastExportAt || settings.installedAt || now;
  const days = Math.floor((now - base) / DAY);
  const added = Math.max(0, cards.length - (settings.cardsAtLastExport || cards.length));
  const chatDays = oldest?.createdAt ? Math.floor((now - oldest.createdAt) / DAY) : 0;
  const due = days >= 7 || added >= 50 || (chatDays >= 30 && days >= 7);
  return { due, days, added, chatDays, settings, cards: cards.length };
}

export async function maybeRemindBackup() {
  if (db.isMemoryMode()) return false;
  await ensureBackupMeta();
  const info = await backupDueInfo();
  if (!info.due) return false;

  const now = Date.now();
  if (info.settings.exportReminderAt && now - info.settings.exportReminderAt < 7 * DAY) {
    return false;
  }

  await db.setSetting('exportReminderAt', now);
  toast('有段时间没备份了，设置里可以加密导出。', 4200);
  return true;
}

export async function refreshDataStatus() {
  if (!$('#dataHint')) return;
  const [storage, info] = await Promise.all([storageState(), backupDueInfo()]);
  const { settings } = info;

  if (storage.memory) {
    $('#dataHint').textContent = '现在是用预览方式打开的，聊天和图片不会保存；恢复只在本次打开有效，关掉会没。要长期保存，请从 http 打开或安装。';
  } else {
    $('#dataHint').textContent = '聊天、图片、字卡只存在这台设备上，不会自动上传。建议每周做一次加密备份。';
  }

  if (storage.memory) {
    $('#storageHint').textContent = '临时内存模式，没有持久占用。';
  } else if (storage.quota) {
    $('#storageHint').textContent = `本机占用约 ${formatBytes(storage.usage)} / 可用约 ${formatBytes(storage.quota)} · ${storage.persisted ? '已申请持久存储' : '尚未持久化'}`;
  } else {
    $('#storageHint').textContent = storage.persisted ? '已申请持久存储。' : '浏览器没有给出存储占用。';
  }

  const last = settings.lastExportAt
    ? `上次导出：${formatFull(settings.lastExportAt)}（${info.days} 天前）`
    : '还没有导出过';
  const added = info.added > 0 ? `，之后新增 ${info.added} 张字卡` : '';
  const due = info.due ? ' · 该备份了' : '';
  $('#exportHint').textContent = `${last}${added}${due}。`;

  const persist = $('#btnPersist');
  if (persist) {
    persist.disabled = storage.memory || storage.persisted;
    persist.textContent = storage.memory ? '预览模式' : (storage.persisted ? '已留在本机' : '申请留在本机');
  }

  const restore = $('#btnRestore');
  if (restore) {
    restore.disabled = false;
    restore.title = storage.memory ? '预览模式：恢复只在本次打开有效' : '';
  }
}

/* ---------------- 备份 / 恢复界面 ---------------- */

function closeBackupSheet() {
  $('#backupSheet').hidden = true;
  $('#backupBackdrop').hidden = true;
}

function closeRestoreSheet() {
  $('#restoreSheet').hidden = true;
  $('#restoreBackdrop').hidden = true;
}

function openBackupSheet() {
  closeRestoreSheet();
  pendingData = null;
  $('#backupPassword').value = '';
  $('#backupPassword2').value = '';
  $('#backupStatus').textContent = '';
  $('#backupBackdrop').hidden = false;
  $('#backupSheet').hidden = false;
  $('#backupHint').textContent = '正在数一数要打包的内容…';
  $('#backupExport').disabled = false;
  $('#backupExport').textContent = '导出备份';

  Promise.all([db.getAllMessages(), db.getCards(), db.getAllMedia()])
    .then(([messages, cards, media]) => {
      $('#backupHint').textContent = `会打包 ${messages.length} 条消息、${cards.length} 张字卡、${media.length} 张图片；用口令加密。`;
    })
    .catch(() => {
      $('#backupHint').textContent = '会打包聊天、字卡、收藏、设置和图片；用口令加密。';
    });

  if (!webcrypto()?.subtle) {
    $('#backupStatus').textContent = '这个浏览器不支持加密备份，先不要导出。';
    $('#backupExport').disabled = true;
  }
  setTimeout(() => $('#backupPassword').focus(), 60);
}

async function doExport() {
  const password = $('#backupPassword').value;
  const again = $('#backupPassword2').value;
  const status = $('#backupStatus');
  const button = $('#backupExport');

  if (password.length < 4) {
    status.textContent = '口令至少 4 位。';
    return;
  }
  if (password !== again) {
    status.textContent = '两次口令不一样。';
    return;
  }

  button.disabled = true;
  button.textContent = '打包中…';
  status.textContent = '正在整理图片…';

  try {
    const result = await exportBackup(password, (done, total) => {
      status.textContent = total ? `正在打包图片 ${done}/${total}…` : '正在打包…';
    });
    status.textContent = `已导出 ${result.filename}（${formatBytes(result.bytes)}）。`;
    $('#backupPassword').value = '';
    $('#backupPassword2').value = '';
    toast('备份导出好了', 2400);
    await refreshDataStatus();
  } catch (error) {
    status.textContent = error.message || '导出失败';
  } finally {
    button.disabled = false;
    button.textContent = '导出备份';
  }
}

async function handleRestoreFile(event) {
  const input = event.target;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  if (file.size > 200 * 1024 * 1024) {
    toast('备份文件太大了', 2800);
    return;
  }

  let envelope;
  try {
    envelope = assertEnvelope(JSON.parse(await file.text()));
  } catch (error) {
    toast(error.message || '读不出这个备份', 3000);
    return;
  }

  pendingEnvelope = envelope;
  pendingName = file.name;
  pendingData = null;

  $('#restoreInfo').textContent = `${file.name} · ${formatBytes(file.size)} · ${formatFull(envelope.createdAt || Date.now())}`;
  $('#restorePassword').value = '';
  $('#restorePassWrap').hidden = !envelope.encrypted;
  $('#restoreSummary').hidden = true;
  $('#restoreStatus').textContent = '';
  $('#restoreStart').hidden = false;
  $('#restoreStart').textContent = envelope.encrypted ? '解密并检查' : '检查备份';
  $('#restoreStart').disabled = false;
  $('#restoreAck').checked = false;
  $('#restoreConfirm').disabled = true;
  $('#restoreBackdrop').hidden = false;
  $('#restoreSheet').hidden = false;

  if (envelope.encrypted) setTimeout(() => $('#restorePassword').focus(), 60);
}

async function startRestore() {
  if (!pendingEnvelope) return;
  const button = $('#restoreStart');
  const status = $('#restoreStatus');
  const password = $('#restorePassword').value;

  button.disabled = true;
  status.textContent = pendingEnvelope.encrypted ? '正在解密…' : '正在检查…';

  try {
    const data = await decryptBackup(pendingEnvelope, password);
    pendingData = data;
    const counts = [
      `${data.messages.length} 条消息`,
      `${data.cards.length} 张字卡`,
      `${data.media.length} 张图片`,
      `${data.collections.length} 条收藏`,
    ].join('、');
    $('#restoreCounts').textContent = counts;
    $('#restoreSummary').hidden = false;
    $('#restoreStart').hidden = true;
    $('#restoreAck').checked = false;
    $('#restoreConfirm').disabled = true;
    status.textContent = '检查通过。勾选下面的确认后再覆盖。';
  } catch (error) {
    status.textContent = error.message || '解密失败';
    button.disabled = false;
  }
}

async function confirmRestore() {
  if (!pendingData || !$('#restoreAck').checked) return;
  const button = $('#restoreConfirm');
  const status = $('#restoreStatus');
  button.disabled = true;
  status.textContent = '正在覆盖…';

  try {
    const counts = await restoreBackup(pendingData);
    if (db.isMemoryMode()) {
      status.textContent = `恢复完成：${counts.messages} 条消息、${counts.cards} 张字卡。预览模式，关掉页面会没。`;
      document.dispatchEvent(new CustomEvent('moon:data-restored'));
      closeRestoreSheet();
      $('#settingsClose')?.click();
      toast('恢复完成；预览模式关掉会没', 3600);
      button.disabled = false;
      return;
    }
    status.textContent = `恢复完成：${counts.messages} 条消息、${counts.cards} 张字卡。正在重启…`;
    toast('恢复完成', 2000);
    setTimeout(() => {
      try { location.reload(); } catch { /* ignore */ }
    }, 500);
  } catch (error) {
    status.textContent = error.message || '恢复失败';
    button.disabled = false;
  }
}

function confirmClearAll() {
  openActionSheet('清空所有数据？先把现在的东西备份下来更稳。', [
    {
      label: '先加密备份',
      onClick: () => openBackupSheet(),
    },
    {
      label: '继续清空',
      danger: true,
      onClick: () => {
        openActionSheet('真的清空？聊天、字卡、图片、设置都会没，不能撤销。', [
          {
            label: '清空',
            danger: true,
            onClick: async () => {
              try {
                await db.clearAllData();
                toast('清空了，正在重启…', 2200);
                setTimeout(() => {
                  try { location.reload(); } catch { /* ignore */ }
                }, 500);
              } catch {
                toast('清空失败，稍后再试', 2600);
              }
            },
          },
        ]);
      },
    },
  ]);
}

export function bindDataSettings() {
  if (bound) return;
  bound = true;

  $('#btnBackup').addEventListener('click', openBackupSheet);
  $('#btnRestore').addEventListener('click', () => {
    $('#restoreFile').click();
  });
  $('#btnPersist').addEventListener('click', () => requestPersist(true));
  $('#btnClearAll').addEventListener('click', confirmClearAll);
  $('#restoreFile').addEventListener('change', handleRestoreFile);

  $('#backupClose').addEventListener('click', closeBackupSheet);
  $('#backupBackdrop').addEventListener('click', closeBackupSheet);
  $('#backupExport').addEventListener('click', doExport);

  $('#restoreClose').addEventListener('click', closeRestoreSheet);
  $('#restoreBackdrop').addEventListener('click', closeRestoreSheet);
  $('#restoreStart').addEventListener('click', startRestore);
  $('#restoreConfirm').addEventListener('click', confirmRestore);
  $('#restoreAck').addEventListener('change', () => {
    $('#restoreConfirm').disabled = !$('#restoreAck').checked;
  });

  $('#backupPassword2').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') doExport();
  });
  $('#restorePassword').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !$('#restoreStart').hidden) startRestore();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!$('#backupSheet').hidden) closeBackupSheet();
    else if (!$('#restoreSheet').hidden) closeRestoreSheet();
  });
}
