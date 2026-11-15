import * as db from './db.js';
import {
  $,
  el,
  toast,
  formatTime,
  formatDay,
  dayKey,
  formatFull,
  formatHourDate,
  openActionSheet,
} from './ui.js';
import { openCardsPage, drawReplyCard } from './cards.js';
import { openCollections, closeCollections, drawBottle } from './collections.js';
import { openStickers, closeStickers } from './stickers.js';
import { openNight } from './night.js';
import { openMusicPage } from './music.js';
import { openDoodle } from './doodle.js';
import { prepareImage } from './media.js';

const PAGE = 30;
const FALLBACK_REPLIES = ['嗯。', '我在。', '慢慢来。'];

const state = {
  msgs: [],
  hasOlder: false,
  hasNewer: false,
  loadingOlder: false,
  loadingNewer: false,
  atBottom: true,
  quote: null,
  replyTimer: 0,
  urls: new Map(),
  bound: false,
  visible: false,
  searching: false,
  typing: false,
  replySeq: 0,
  names: { me: '我', moon: 'moon' },
};

const SPEED_RANGES = {
  fast: [300, 900],
  natural: [850, 2300],
  slow: [1900, 3800],
};

const BOTTLE_CHANCE = 0.06;

/* ---------------- 工具 ---------------- */

function distanceFromBottom(box) {
  return box.scrollHeight - box.scrollTop - box.clientHeight;
}

async function mediaURL(mediaId) {
  if (!mediaId) return null;
  if (state.urls.has(mediaId)) return state.urls.get(mediaId);
  const record = await db.getMedia(mediaId);
  if (!record) return null;
  const url = URL.createObjectURL(record.blob);
  state.urls.set(mediaId, url);
  return url;
}

function roleName(role) {
  return role === 'moon' ? state.names.moon : state.names.me;
}

export function setNames(me, moon) {
  state.names = {
    me: String(me || '').trim() || '我',
    moon: String(moon || '').trim() || 'moon',
  };
  if (state.visible) render({ mode: 'keep' });
}

/* ---------------- 渲染 ---------------- */

function quoteBlock(quote) {
  const node = el('span', { class: 'quote' },
    el('b', { text: roleName(quote.role) }),
    document.createTextNode(quote.text || '')
  );

  if (quote.id) {
    node.setAttribute('role', 'button');
    node.tabIndex = 0;
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      jumpToQuote(quote.id);
    });
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        jumpToQuote(quote.id);
      }
    });
  }

  return node;
}

function fillImage(img, msg) {
  if (msg.width && msg.height) {
    img.width = msg.width;
    img.height = msg.height;
  }
  mediaURL(msg.mediaId).then((url) => {
    if (!url) {
      img.alt = '图片已经找不到了';
      return;
    }
    img.src = url;
  });
}

function messageEl(msg) {
  const row = el('div', { class: `msg-row ${msg.role}`, dataset: { id: msg.id } });
  const bubble = el('div', { class: 'bubble' });

  if (msg.quote) bubble.append(quoteBlock(msg.quote));

  if (msg.type === 'bottle') {
    bubble.classList.add('bottle');
    bubble.append(
      el('div', { class: 'bottle-label', text: '漂流瓶 · moon' }),
      el('p', { class: 'bottle-line', text: `「${msg.text || ''}」` }),
      msg.bottle?.collectedAt
        ? el('div', { class: 'bottle-date', text: `收藏于 ${formatHourDate(msg.bottle.collectedAt)}` })
        : null
    );
  } else if (msg.type === 'image') {
    bubble.classList.add('media');
    const img = el('img', { alt: '图片', draggable: 'false' });
    img.addEventListener('click', () => openViewer(img.src));
    bubble.append(img);
    fillImage(img, msg);
  } else {
    bubble.append(document.createTextNode(msg.text || ''));
  }

  row.append(bubble, el('span', { class: 'msg-time', text: formatTime(msg.createdAt) }));
  attachMenu(row, bubble, msg);
  return row;
}

function render({ mode = 'none' } = {}) {
  const box = $('#messages');
  const before = {
    top: box.scrollTop,
    height: box.scrollHeight,
    bottomDist: box.scrollHeight - box.scrollTop - box.clientHeight,
  };

  const frag = document.createDocumentFragment();
  let lastDay = '';
  for (const msg of state.msgs) {
    const key = dayKey(msg.createdAt);
    if (key !== lastDay) {
      frag.append(el('div', { class: 'day-sep', text: formatDay(msg.createdAt) }));
      lastDay = key;
    }
    frag.append(messageEl(msg));
  }
  if (state.typing) {
    frag.append(
      el('div', { class: 'msg-row moon typing-row', 'aria-label': 'moon 正在写' },
        el('div', { class: 'bubble' }, el('span'), el('span'), el('span'))
      )
    );
  }

  box.replaceChildren(frag);

  if (mode === 'bottom') {
    box.scrollTop = box.scrollHeight;
    state.atBottom = true;
    clearPill();
  } else if (mode === 'prepend') {
    box.scrollTop = before.top + (box.scrollHeight - before.height);
  } else if (mode === 'keep-bottom') {
    box.scrollTop = box.scrollHeight - before.bottomDist - box.clientHeight;
  } else if (mode === 'keep') {
    box.scrollTop = before.top;
  }

  const down = $('#toBottom');
  if (down) down.hidden = state.atBottom;
}

/* ---------------- 新消息提示 ---------------- */

function showPill() {
  const pill = $('#newPill');
  pill.hidden = false;
}

function clearPill() {
  $('#newPill').hidden = true;
}

/* ---------------- 引用 ---------------- */

function setQuote(msg) {
  state.quote = {
    id: msg.id,
    role: msg.role,
    text: msg.type === 'image' ? '[图片]' : (msg.text || ''),
  };
  $('#quoteWho').textContent = roleName(msg.role);
  $('#quoteText').textContent = state.quote.text;
  $('#quoteBar').hidden = false;
  $('#input').focus();
}

function clearQuote() {
  state.quote = null;
  $('#quoteBar').hidden = true;
}

/* ---------------- 大图 ---------------- */

function openViewer(src) {
  if (!src) return;
  $('#viewerImg').src = src;
  $('#viewer').hidden = false;
}

function closeViewer() {
  const viewer = $('#viewer');
  if (viewer.hidden) return;
  viewer.hidden = true;
  $('#viewerImg').removeAttribute('src');
}

/* ---------------- 消息菜单 ---------------- */

function openMenu(msg) {
  const actions = [];
  const latestMoon = [...state.msgs].reverse().find((m) => m.role === 'moon');
  const textLike = msg.type === 'text' || msg.type === 'bottle';

  if (msg.role === 'moon' && msg.type === 'text' && latestMoon && msg.id === latestMoon.id) {
    actions.push({ label: '换一句', onClick: () => reroll(msg) });
  }

  actions.push({ label: '引用', onClick: () => setQuote(msg) });

  if (textLike && msg.text) {
    actions.push({
      label: '复制',
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(msg.text);
          toast('复制了');
        } catch {
          toast('复制不了，长按选中吧');
        }
      },
    });
    actions.push({
      label: '收藏这句话',
      onClick: async () => {
        const all = await db.getCollections();
        const same = all.some((item) =>
          item.role === msg.role && String(item.text || '').trim() === String(msg.text || '').trim()
        );
        if (same) {
          toast('已经收藏过了');
          return;
        }
        await db.addCollection({ text: msg.text, messageId: msg.id, role: msg.role });
        toast(msg.role === 'me' ? '收藏了；moon 偶尔会装进瓶子' : '收藏了');
      },
    });
  }

  if (msg.role === 'me') {
    actions.push({
      label: '删除',
      danger: true,
      onClick: () => {
        openActionSheet('删掉这句话？', [{
          label: '删掉',
          danger: true,
          onClick: async () => {
            await db.deleteMessage(msg.id);
            state.msgs = state.msgs.filter((m) => m.id !== msg.id);
            render({ mode: 'keep' });
            toast('删掉了');
          },
        }]);
      },
    });
  }

  openActionSheet(null, actions);
}

function attachMenu(row, bubble, msg) {
  let timer = 0;
  let start = null;
  let suppressUntil = 0;

  const down = (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    start = { x: event.clientX, y: event.clientY };
    clearTimeout(timer);
    timer = setTimeout(() => {
      suppressUntil = Date.now() + 700;
      openMenu(msg);
    }, 480);
  };

  const move = (event) => {
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
      clearTimeout(timer);
      start = null;
    }
  };

  const up = () => {
    clearTimeout(timer);
    start = null;
  };

  bubble.addEventListener('pointerdown', down);
  bubble.addEventListener('pointermove', move);
  bubble.addEventListener('pointerup', up);
  bubble.addEventListener('pointercancel', up);
  bubble.addEventListener('pointerleave', up);

  bubble.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    clearTimeout(timer);
    suppressUntil = Date.now() + 700;
    openMenu(msg);
  });

  row.addEventListener('click', (event) => {
    if (Date.now() > suppressUntil) return;
    suppressUntil = 0;
    event.preventDefault();
    event.stopPropagation();
  }, true);
}

/* ---------------- 发送与回复 ---------------- */

function syncSend() {
  $('#send').disabled = !$('#input').value.trim();
}

function autoGrow() {
  const input = $('#input');
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
}

async function send({ type = 'text', text = '', mediaId = null, width = 0, height = 0 }) {
  if (state.hasNewer) await loadLatest();

  const quote = state.quote;
  const msg = await db.addMessage({ role: 'me', type, text, mediaId, width, height, quote });

  clearQuote();
  state.msgs.push(msg);
  state.hasNewer = false;
  render({ mode: 'bottom' });
  clearPill();
  scheduleReply();
  document.dispatchEvent(new CustomEvent('moon:message'));
}

async function scheduleReply() {
  clearTimeout(state.replyTimer);
  const seq = ++state.replySeq;
  state.typing = true;
  render({ mode: state.atBottom ? 'bottom' : 'keep' });

  const speed = (await db.getSetting('replySpeed')) || 'natural';
  const countSetting = (await db.getSetting('replyCount')) || '1';
  if (seq !== state.replySeq) return;

  const range = SPEED_RANGES[speed] || SPEED_RANGES.natural;
  const delay = range[0] + Math.random() * (range[1] - range[0]);

  state.replyTimer = setTimeout(async () => {
    state.replyTimer = 0;
    if (seq !== state.replySeq) return;

    const lastMoon = [...state.msgs].reverse().find((m) => m.role === 'moon');
    if (lastMoon?.type !== 'bottle' && Math.random() < BOTTLE_CHANCE) {
      let bottle = null;
      try {
        bottle = await drawBottle();
      } catch { /* 抽不到就正常回卡 */ }
      if (bottle) {
        const wasAtBottom = state.atBottom;
        state.typing = false;
        const msg = await db.addMessage({
          role: 'moon',
          type: 'bottle',
          text: bottle.text,
          bottle: {
            collectionId: bottle.collectionId,
            collectedAt: bottle.collectedAt,
          },
        });
        state.msgs.push(msg);
        render({ mode: wasAtBottom ? 'bottom' : 'keep' });
        if (!wasAtBottom) showPill();
        document.dispatchEvent(new CustomEvent('moon:message'));
        return;
      }
    }

    const desired = countSetting === '1-2'
      ? (Math.random() < 0.5 ? 1 : 2)
      : (Number(countSetting) || 1);

    const texts = [];
    for (let i = 0; i < desired; i++) {
      const card = await drawReplyCard(texts[texts.length - 1] || '');
      if (card && !texts.includes(card.text)) texts.push(card.text);
    }

    const text = texts.length
      ? texts.join('\n')
      : FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];

    const wasAtBottom = state.atBottom;
    state.typing = false;
    const msg = await db.addMessage({ role: 'moon', type: 'text', text });
    state.msgs.push(msg);
    render({ mode: wasAtBottom ? 'bottom' : 'keep' });
    if (!wasAtBottom) showPill();
    document.dispatchEvent(new CustomEvent('moon:message'));
  }, delay);
}

async function reroll(msg) {
  const lineCount = Math.min(3, Math.max(1, String(msg.text || '').split('\n').length));
  const texts = [];
  for (let i = 0; i < lineCount; i++) {
    const card = await drawReplyCard(texts[texts.length - 1] || msg.text);
    if (card && !texts.includes(card.text)) texts.push(card.text);
  }
  const text = texts.length
    ? texts.join('\n')
    : FALLBACK_REPLIES[Math.floor(Math.random() * FALLBACK_REPLIES.length)];

  const updated = await db.updateMessage(msg.id, { text });
  if (!updated) {
    toast('这条消息找不到了');
    return;
  }
  state.msgs = state.msgs.map((m) => (m.id === msg.id ? updated : m));
  const wasAtBottom = state.atBottom;
  render({ mode: wasAtBottom ? 'bottom' : 'keep' });
  toast('换了一句');
}

function sendCard(card) {
  if (card.type === 'image' && card.mediaId) {
    send({
      type: 'image',
      text: '[表情包]',
      mediaId: card.mediaId,
      width: card.width,
      height: card.height,
    });
  } else {
    send({ text: card.text });
  }
}

function openCardPage(category) {
  openCardsPage({ onSend: sendCard, category });
}

function startDoodle() {
  openDoodle({
    onSave: async (blob) => {
      try {
        const prepared = await prepareImage(blob);
        const mediaId = await db.putMedia(prepared.blob, {
          width: prepared.width,
          height: prepared.height,
          mime: prepared.blob.type,
        });
        await send({
          type: 'image',
          text: '[图片]',
          mediaId,
          width: prepared.width,
          height: prepared.height,
        });
      } catch (error) {
        toast(error.message || '涂鸦没发出去');
      }
    },
  });
}

function sendText() {
  const input = $('#input');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  $('#plusMenu').hidden = true;
  syncSend();
  send({ text });
}

async function sendFiles(files) {
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const prepared = await prepareImage(file);
      const mediaId = await db.putMedia(prepared.blob, {
        width: prepared.width,
        height: prepared.height,
        mime: prepared.blob.type,
      });
      await send({
        type: 'image',
        text: '[图片]',
        mediaId,
        width: prepared.width,
        height: prepared.height,
      });
    } catch (error) {
      toast(error.message || '图片没发出去');
    }
  }
}

/* ---------------- 历史 / 加载 ---------------- */

async function loadLatest() {
  const msgs = await db.getRecentMessages(PAGE);
  state.msgs = msgs;
  state.hasOlder = msgs.length >= PAGE;
  state.hasNewer = false;
  state.atBottom = true;
  clearPill();
  render({ mode: 'bottom' });
  requestAnimationFrame(() => {
    const box = $('#messages');
    box.scrollTop = box.scrollHeight;
  });
}

async function loadOlder() {
  if (state.loadingOlder || !state.hasOlder || !state.msgs.length) return;
  state.loadingOlder = true;
  try {
    const older = await db.getMessagesBefore(state.msgs[0].createdAt, PAGE);
    if (!older.length) {
      state.hasOlder = false;
      return;
    }
    state.msgs = [...older, ...state.msgs];
    render({ mode: 'prepend' });
    if (older.length < PAGE) state.hasOlder = false;
  } finally {
    state.loadingOlder = false;
  }
}

async function loadNewer() {
  if (state.loadingNewer || !state.hasNewer || !state.msgs.length) return;
  state.loadingNewer = true;
  try {
    const newer = await db.getMessagesAfter(state.msgs[state.msgs.length - 1].createdAt, PAGE);
    if (!newer.length) {
      state.hasNewer = false;
      return;
    }
    state.msgs = [...state.msgs, ...newer];
    render({ mode: 'keep' });
    if (newer.length < PAGE) state.hasNewer = false;
  } finally {
    state.loadingNewer = false;
  }
}

/* ---------------- 搜索 ---------------- */

function openSearch() {
  state.searching = true;
  $('#searchPanel').hidden = false;
  $('#searchResults').replaceChildren(el('p', { class: 'search-empty', text: '输入几个字，找找说过的话。' }));
  const input = $('#searchInput');
  input.value = '';
  input.focus();
}

function closeSearch() {
  state.searching = false;
  $('#searchPanel').hidden = true;
  $('#searchInput').blur();
}

async function runSearch(query) {
  const list = $('#searchResults');
  const q = query.trim();
  if (!q) {
    list.replaceChildren(el('p', { class: 'search-empty', text: '输入几个字，找找说过的话。' }));
    return;
  }
  const results = await db.searchMessages(q);
  if (!results.length) {
    list.replaceChildren(el('p', { class: 'search-empty', text: '没有找到。' }));
    return;
  }
  list.replaceChildren(
    ...results.map((msg) =>
      el('button', {
        type: 'button',
        class: 'search-item',
        onclick: async () => {
          closeSearch();
          await jumpTo(msg);
        },
      },
        el('span', { class: 'who', text: roleName(msg.role) }),
        document.createTextNode(msg.type === 'image' ? '[图片]' : msg.text),
        el('span', { class: 'when', text: formatFull(msg.createdAt) })
      )
    )
  );
}

async function jumpToQuote(id) {
  let target = state.msgs.find((m) => m.id === id);

  if (!target) {
    target = await db.getMessage(id);
    if (!target) {
      toast('原消息找不到了');
      return;
    }
    const around = await db.getMessagesAround(target.createdAt, 25, 30);
    state.msgs = around;
    state.hasOlder = true;
    state.hasNewer = true;
    state.atBottom = false;
    render();
  }

  const node = $(`#messages [data-id="${id}"]`);
  if (!node) return;

  node.scrollIntoView({ block: 'center' });
  node.classList.add('hit');
  setTimeout(() => node.classList.remove('hit'), 2400);
  state.atBottom = false;
  const down = $('#toBottom');
  if (down) down.hidden = false;
}

async function jumpTo(msg) {
  const around = await db.getMessagesAround(msg.createdAt, 25, 30);
  state.msgs = around;
  state.hasOlder = true;
  state.hasNewer = true;
  state.atBottom = false;
  render();
  const node = $(`#messages [data-id="${msg.id}"]`);
  if (node) {
    node.classList.add('hit');
    setTimeout(() => node.classList.remove('hit'), 2400);
    try {
      node.scrollIntoView({ block: 'center', behavior: 'auto' });
    } catch {
      try { node.scrollIntoView(); } catch { /* 老 WebView 不支持参数 */ }
    }
  }
}

/* ---------------- 绑定 ---------------- */

function bind() {
  if (state.bound) return;
  state.bound = true;

  $('#chatBack').addEventListener('click', requestClose);
  $('#chatSearchBtn').addEventListener('click', openSearch);
  $('#searchClose').addEventListener('click', closeSearch);

  const searchInput = $('#searchInput');
  let searchTimer = 0;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(searchInput.value), 200);
  });

  const box = $('#messages');
  box.addEventListener('scroll', () => {
    $('#plusMenu').hidden = true;
    state.atBottom = distanceFromBottom(box) < 48;
    const down = $('#toBottom');
    if (down) down.hidden = state.atBottom;
    if (state.atBottom) clearPill();
    if (box.scrollTop < 80) loadOlder();
    if (distanceFromBottom(box) < 80 && state.hasNewer) loadNewer();
  }, { passive: true });

  $('#toBottom').addEventListener('click', () => {
    box.scrollTop = box.scrollHeight;
    state.atBottom = true;
    clearPill();
    $('#toBottom').hidden = true;
  });

  $('#newPill').addEventListener('click', () => {
    box.scrollTop = box.scrollHeight;
    state.atBottom = true;
    clearPill();
  });

  const input = $('#input');
  input.addEventListener('input', () => {
    autoGrow();
    syncSend();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendText();
    }
  });
  input.addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) {
      event.preventDefault();
      sendFiles(files);
    }
  });

  $('#send').addEventListener('click', sendText);
  $('#quoteClear').addEventListener('click', clearQuote);

  $('#chatCards').addEventListener('click', () => openCardPage());
  $('#railCards')?.addEventListener('click', () => openCardPage());
  $('#railCollections')?.addEventListener('click', () => openCollections('collections'));
  $('#railBottles')?.addEventListener('click', () => openCollections('bottles'));

  $('#imageInput').addEventListener('change', (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    if (files.length) sendFiles(files);
  });

  const plusMenu = $('#plusMenu');
  $('#btnPlus').addEventListener('click', (event) => {
    event.stopPropagation();
    plusMenu.hidden = !plusMenu.hidden;
  });

  plusMenu.addEventListener('click', (event) => {
    const action = event.target.closest('button')?.dataset.act;
    if (!action) return;
    plusMenu.hidden = true;
    if (action === 'stickers') openStickers({ onSend: sendCard, onManage: () => openCardPage('表情包') });
    else if (action === 'collections') openCollections('collections');
    else if (action === 'image') $('#imageInput').click();
    else if (action === 'night') openNight();
    else if (action === 'music') openMusicPage();
    else if (action === 'doodle') startDoodle();
    else if (action === 'love') document.dispatchEvent(new CustomEvent('moon:open-love'));
  });

  document.addEventListener('click', (event) => {
    if (plusMenu.hidden) return;
    if (event.target.closest('#plusMenu') || event.target.closest('#btnPlus')) return;
    plusMenu.hidden = true;
  });

  $('#viewerClose').addEventListener('click', closeViewer);
  $('#viewer').addEventListener('click', (event) => {
    if (event.target === $('#viewer')) closeViewer();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!$('#viewer').hidden) closeViewer();
    else if (!$('#searchPanel').hidden) closeSearch();
    else if (!$('#plusMenu').hidden) $('#plusMenu').hidden = true;
  });

  window.addEventListener('popstate', () => {
    if (history.state && history.state.view === 'chat') {
      if (document.body.dataset.view !== 'chat') showChat(false);
    } else if (document.body.dataset.view === 'chat') {
      hideChatUI();
    }
  });

  window.addEventListener('resize', () => {
    if (!state.visible) return;
    if (state.atBottom) box.scrollTop = box.scrollHeight;
  });
}

/* ---------------- 打开 / 关闭 ---------------- */

async function showChat(push) {
  bind();
  state.visible = true;
  $('#openView').hidden = true;
  $('#chat').hidden = false;
  document.body.dataset.view = 'chat';
  closeViewer();
  closeSearch();
  clearQuote();
  $('#plusMenu').hidden = true;
  await loadLatest();
  if (push && (!history.state || history.state.view !== 'chat')) {
    history.pushState({ view: 'chat' }, '');
  }
  document.dispatchEvent(new CustomEvent('moon:chat-open'));
}

export async function reloadChat() {
  clearTimeout(state.replyTimer);
  state.replyTimer = 0;
  state.replySeq += 1;
  state.typing = false;
  state.quote = null;
  state.msgs = [];
  state.hasOlder = true;
  state.hasNewer = false;
  state.atBottom = true;
  clearQuote();
  await loadLatest();
  render({ mode: 'bottom' });
}

export async function openChat() {
  await showChat(true);
}

function hideChatUI() {
  state.visible = false;
  closeStickers();
  closeCollections();
  $('#chat').hidden = true;
  $('#openView').hidden = false;
  document.body.dataset.view = 'open';
  document.dispatchEvent(new CustomEvent('moon:home'));
}

function requestClose() {
  if (history.state && history.state.view === 'chat') history.back();
  else hideChatUI();
}
