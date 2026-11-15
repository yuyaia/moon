import * as db from './db.js';
import { $, el, toast } from './ui.js';

let bound = false;
let tracks = [];
let currentId = null;
let pageVisible = false;
let objectUrls = new Map();

function fmt(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return '0:00';
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function audioEl() {
  return $('#musicAudio');
}

function syncMini() {
  const mini = $('#musicMini');
  if (!mini) return;
  const show = !!currentId && !pageVisible;
  mini.hidden = !show;
  const track = tracks.find((item) => item.id === currentId);
  mini.title = track ? `音乐：${track.title}` : '打开音乐';
}

async function objectURL(mediaId) {
  if (!mediaId) return null;
  if (objectUrls.has(mediaId)) return objectUrls.get(mediaId);
  const record = await db.getMedia(mediaId);
  if (!record?.blob) return null;
  const url = URL.createObjectURL(record.blob);
  objectUrls.set(mediaId, url);
  return url;
}

async function trackSrc(track) {
  if (track.url) return track.url;
  return objectURL(track.mediaId);
}

function renderPlayer() {
  const player = $('#musicPlayer');
  const track = tracks.find((item) => item.id === currentId);
  if (!track) {
    player.hidden = true;
    $('#musicNow').textContent = '';
    return;
  }
  player.hidden = false;
  $('#musicNow').textContent = track.title;
  $('#musicPlay').textContent = audioEl().paused ? '▶' : '❚❚';
  updateProgress();
}

function updateProgress() {
  const audio = audioEl();
  const seek = $('#musicSeek');
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  const current = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  seek.max = duration || 100;
  seek.value = duration ? current : 0;
  $('#musicNowTime').textContent = fmt(current);
  $('#musicDuration').textContent = fmt(duration);
}

function renderList() {
  const list = $('#musicList');
  $('#musicCount').textContent = tracks.length ? `${tracks.length} 首` : '';
  if (!tracks.length) {
    list.replaceChildren(
      el('p', { class: 'music-empty', text: '还没有音乐。贴一个音频直链，或从手机上传。' })
    );
    return;
  }

  list.replaceChildren(
    ...tracks.map((track, index) => {
      const active = track.id === currentId;
      const play = el('button', {
        type: 'button',
        class: 'music-playbtn',
        'aria-label': active ? '播放或暂停' : '播放这首',
        text: active && !audioEl().paused ? '❚❚' : '▶',
        onclick: async (event) => {
          event.stopPropagation();
          if (active) togglePlay();
          else await playTrack(track.id);
        },
      });

      const meta = el('div', { class: 'music-meta' },
        el('div', { class: 'music-title', text: track.title || '未命名音频' }),
        el('div', {
          class: 'music-sub',
          text: `${track.source === 'file' ? '本机文件' : '链接'}${track.duration ? ` · ${fmt(track.duration)}` : ''}`,
        })
      );

      const del = el('button', {
        type: 'button',
        class: 'music-del',
        text: '×',
        'aria-label': '删掉这首',
        onclick: async (event) => {
          event.stopPropagation();
          await removeTrack(track.id);
        },
      });

      const row = el('div', {
        class: `music-item${active ? ' active' : ''}`,
        onclick: async () => {
          if (active) togglePlay();
          else await playTrack(track.id);
        },
      }, play, meta, del);
      return row;
    })
  );
}

function render() {
  renderList();
  renderPlayer();
  syncMini();
}

async function refresh() {
  tracks = await db.getTracks();
  if (currentId && !tracks.some((track) => track.id === currentId)) {
    currentId = null;
    const audio = audioEl();
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  render();
}

async function playTrack(id) {
  const track = tracks.find((item) => item.id === id);
  if (!track) return;
  const src = await trackSrc(track);
  if (!src) {
    toast('这首音频找不到了');
    return;
  }

  const audio = audioEl();
  currentId = id;
  try {
    if (audio.getAttribute('src') !== src) {
      audio.src = src;
      audio.currentTime = 0;
    }
    await audio.play();
  } catch {
    toast('浏览器没有播放，再点一次试试');
  }
  render();
}

async function togglePlay() {
  const audio = audioEl();
  if (!currentId) {
    if (tracks.length) await playTrack(tracks[0].id);
    return;
  }
  if (audio.paused) {
    try { await audio.play(); } catch { toast('播放失败，链接可能失效'); }
  } else {
    audio.pause();
  }
  renderPlayer();
  syncMini();
}

async function step(delta) {
  if (!tracks.length) return;
  const index = tracks.findIndex((track) => track.id === currentId);
  const next = Math.max(0, Math.min(tracks.length - 1, index + delta));
  if (next === index) return;
  await playTrack(tracks[next].id);
}

function titleFromUrl(value) {
  try {
    const url = new URL(value);
    let last = '';
    try { last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || ''); } catch { last = ''; }
    const clean = last.replace(/\.(mp3|m4a|ogg|oga|wav|aac|flac|webm)$/i, '');
    return clean || url.hostname || '未命名音频';
  } catch {
    return '未命名音频';
  }
}

function validAudioUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  if (location.protocol === 'https:' && url.protocol === 'http:') return null;
  return url.toString();
}

async function addUrls() {
  const input = $('#musicUrls');
  const lines = input.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) {
    input.focus();
    return;
  }

  const existing = new Set(tracks.filter((track) => track.url).map((track) => track.url));
  const seen = new Set();
  let added = 0;
  let invalid = 0;
  let duplicate = 0;

  for (const line of lines) {
    const url = validAudioUrl(line);
    if (!url) { invalid += 1; continue; }
    if (existing.has(url) || seen.has(url)) { duplicate += 1; continue; }
    seen.add(url);
    await db.addTrack({ title: titleFromUrl(url), url, source: 'url' });
    added += 1;
  }

  input.value = '';
  await refresh();
  if (added) {
    closeMusicAddSheet();
    toast(`加了 ${added} 首`);
  }
  else if (duplicate) toast('这些链接已经在了');
  else if (invalid) toast('没有可用的 https 音频直链');
}

async function uploadFiles(files) {
  let added = 0;
  let failed = 0;
  for (const file of files) {
    if (!file.type.startsWith('audio/') && !/\.(mp3|m4a|ogg|oga|wav|aac|flac|webm)$/i.test(file.name)) {
      failed += 1;
      continue;
    }
    if (file.size > 40 * 1024 * 1024) {
      failed += 1;
      continue;
    }
    try {
      const mediaId = await db.putMedia(file, {
        mime: file.type || 'audio/mpeg',
        kind: 'audio',
        name: file.name,
        size: file.size,
      });
      await db.addTrack({
        title: file.name.replace(/\.[^.]+$/, '') || '本机音频',
        mediaId,
        mime: file.type || 'audio/mpeg',
        size: file.size,
        source: 'file',
      });
      added += 1;
    } catch {
      failed += 1;
    }
  }
  await refresh();
  if (added) {
    closeMusicAddSheet();
    toast(`上传了 ${added} 首`);
  }
  if (failed) toast(`${failed} 个文件没加进去`);
}

async function removeTrack(id) {
  const track = tracks.find((item) => item.id === id);
  if (!track) return;
  if (currentId === id) {
    const audio = audioEl();
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    currentId = null;
  }
  await db.deleteTrack(id);
  if (track.source === 'file' && track.mediaId) {
    await db.deleteMedia(track.mediaId);
    const url = objectUrls.get(track.mediaId);
    if (url) URL.revokeObjectURL(url);
    objectUrls.delete(track.mediaId);
  }
  toast('删掉了');
  await refresh();
}

function setMusicAddTab(tab) {
  const isFile = tab === 'file';
  $('#musicLinkPane').hidden = isFile;
  $('#musicFilePane').hidden = !isFile;
  for (const button of document.querySelectorAll('#musicAddTabs button')) {
    button.classList.toggle('active', (button.dataset.mtab === 'file') === isFile);
  }
}

function openMusicAddSheet() {
  bind();
  $('#musicAddBackdrop').hidden = false;
  $('#musicAddSheet').hidden = false;
  setMusicAddTab('link');
  setTimeout(() => $('#musicUrls').focus(), 40);
}

function closeMusicAddSheet() {
  $('#musicAddSheet').hidden = true;
  $('#musicAddBackdrop').hidden = true;
}

function bind() {
  if (bound) return;
  bound = true;

  $('#musicBack').addEventListener('click', closeMusicPage);
  $('#musicAddOpen').addEventListener('click', openMusicAddSheet);
  $('#musicAddClose').addEventListener('click', closeMusicAddSheet);
  $('#musicAddBackdrop').addEventListener('click', closeMusicAddSheet);
  $('#musicAddTabs').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-mtab]');
    if (button) setMusicAddTab(button.dataset.mtab);
  });
  $('#musicAddUrls').addEventListener('click', addUrls);
  $('#musicUploadBtn').addEventListener('click', () => {
    const input = $('#musicFile');
    input.value = '';
    input.click();
  });
  $('#musicFile').addEventListener('change', async (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    if (files.length) await uploadFiles(files);
  });

  $('#musicPlay').addEventListener('click', togglePlay);
  $('#musicPrev').addEventListener('click', () => step(-1));
  $('#musicNext').addEventListener('click', () => step(1));
  $('#musicMini').addEventListener('click', openMusicPage);
  $('#musicSeek').addEventListener('input', () => {
    const audio = audioEl();
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      audio.currentTime = (Number($('#musicSeek').value) / Number($('#musicSeek').max || 1)) * audio.duration;
    }
  });

  const audio = audioEl();
  audio.addEventListener('play', () => { renderPlayer(); });
  audio.addEventListener('pause', () => { renderPlayer(); });
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('loadedmetadata', updateProgress);
  audio.addEventListener('ended', () => {
    if (currentId) {
      const index = tracks.findIndex((track) => track.id === currentId);
      if (index >= 0 && index < tracks.length - 1) step(1);
      else { renderPlayer(); syncMini(); }
    }
  });
  audio.addEventListener('error', () => {
    toast('这首放不了：链接可能失效、防盗链或网络错误', 3000);
    renderPlayer();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!$('#musicAddSheet').hidden) {
      closeMusicAddSheet();
      return;
    }
    if (!$('#musicView').hidden) closeMusicPage();
  });
}

document.addEventListener('moon:home', () => {
  closeMusicAddSheet();
  if (!$('#musicView').hidden) closeMusicPage();
});

export async function openMusicPage() {
  bind();
  pageVisible = true;
  $('#musicView').hidden = false;
  $('#musicMini').hidden = true;
  await refresh();
}

export function closeMusicPage() {
  pageVisible = false;
  closeMusicAddSheet();
  $('#musicView').hidden = true;
  syncMini();
}
