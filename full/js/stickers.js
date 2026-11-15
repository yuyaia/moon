import * as db from './db.js';
import { $, el } from './ui.js';

let bound = false;
let sendCb = null;
let manageCb = null;
const urls = new Map();

function bind() {
  if (bound) return;
  bound = true;

  $('#stickersClose').addEventListener('click', closeStickers);
  $('#stickersBackdrop').addEventListener('click', closeStickers);
  $('#stickerManage').addEventListener('click', () => {
    closeStickers();
    manageCb?.();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#stickersSheet').hidden) closeStickers();
  });
}

async function mediaURL(mediaId) {
  if (!mediaId) return null;
  if (urls.has(mediaId)) return urls.get(mediaId);
  const record = await db.getMedia(mediaId);
  if (!record?.blob) return null;
  const url = URL.createObjectURL(record.blob);
  urls.set(mediaId, url);
  return url;
}

async function render() {
  const cards = (await db.getCards()).filter(
    (card) => card.type === 'image' && card.category === '表情包'
  );
  const grid = $('#stickerGrid');
  const empty = $('#stickerEmpty');

  grid.replaceChildren();
  if (!cards.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const card of cards) {
    const button = el('button', {
      type: 'button',
      class: 'sticker-item',
      'aria-label': '发送这个表情包',
    });
    const img = el('img', { alt: '表情包' });
    const url = await mediaURL(card.mediaId);
    if (url) img.src = url;
    else img.alt = '图片找不到了';
    button.append(img);
    button.addEventListener('click', () => {
      const cb = sendCb;
      closeStickers();
      cb?.(card);
    });
    grid.append(button);
  }
}

export async function openStickers({ onSend, onManage } = {}) {
  bind();
  sendCb = onSend || null;
  manageCb = onManage || null;
  await render();
  $('#stickersBackdrop').hidden = false;
  $('#stickersSheet').hidden = false;
}

export function closeStickers() {
  $('#stickersSheet').hidden = true;
  $('#stickersBackdrop').hidden = true;
}
