import * as db from './db.js';
import { $, el, toast, formatFull, formatHourDate } from './ui.js';

let bound = false;
let activeTab = 'collections';

function bind() {
  if (bound) return;
  bound = true;

  $('#collectionsClose').addEventListener('click', closeCollections);
  $('#collectionsBackdrop').addEventListener('click', closeCollections);

  for (const button of document.querySelectorAll('#drawerTabs button')) {
    button.addEventListener('click', () => {
      activeTab = button.dataset.tab === 'bottles' ? 'bottles' : 'collections';
      render();
    });
  }

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#collectionsSheet').hidden) closeCollections();
  });
}

export function closeCollections() {
  $('#collectionsSheet').hidden = true;
  $('#collectionsBackdrop').hidden = true;
}

async function render() {
  for (const button of document.querySelectorAll('#drawerTabs button')) {
    button.classList.toggle('active', button.dataset.tab === activeTab);
  }

  if (activeTab === 'bottles') {
    await renderBottles();
    return;
  }

  const items = (await db.getCollections()).slice().reverse();
  const list = $('#collectionsList');
  const hint = $('#collectionsHint');

  if (!items.length) {
    hint.textContent = '还没有收藏。长按一句话 → 收藏这句话。';
    list.replaceChildren(
      el('p', { class: 'collections-empty', text: '自己说的话，moon 偶尔会装进漂流瓶还给你。' })
    );
    return;
  }

  const userCount = items.filter((item) => item.role === 'me').length;
  hint.textContent = userCount
    ? `${items.length} 句 · 其中 ${userCount} 句是你自己的，moon 偶尔会装进漂流瓶还给你。`
    : `${items.length} 句 · 收藏几句自己说的话，moon 偶尔会装进瓶子还给你。`;

  list.replaceChildren(
    ...items.map((item) => {
      const head = el('div', { class: 'collection-top' },
        el('span', { class: 'collection-who', text: item.role === 'me' ? '我' : 'moon' }),
        el('time', { class: 'collection-time', text: formatFull(item.collectedAt) }),
        el('button', {
          type: 'button',
          class: 'collection-del',
          text: '×',
          'aria-label': '取消收藏',
          onclick: async () => {
            await db.deleteCollection(item.id);
            toast('取消收藏了');
            render();
          },
        })
      );

      return el('article', { class: 'collection-item', dataset: { id: item.id } },
        head,
        el('p', { class: 'collection-text', text: item.text || '' })
      );
    })
  );
}

async function renderBottles() {
  const bottles = await db.getBottleMessages(30);
  const list = $('#collectionsList');
  const hint = $('#collectionsHint');

  if (!bottles.length) {
    hint.textContent = '瓶子还没漂来。';
    list.replaceChildren(
      el('p', { class: 'collections-empty', text: '收藏几句你自己说的话，moon 偶尔会捞起一句，装进瓶子还给你。' })
    );
    return;
  }

  hint.textContent = `${bottles.length} 个瓶子 · 都是你以前说过、后来被 moon 捞起来的话。`;
  list.replaceChildren(
    ...bottles.map((message) =>
      el('article', { class: 'bottle-item' },
        el('div', { class: 'collection-top' },
          el('span', { class: 'collection-who', text: '漂流瓶 · moon' }),
          el('time', { class: 'collection-time', text: formatFull(message.createdAt) })
        ),
        el('p', { class: 'collection-text', text: `「${message.text || ''}」` }),
        message.bottle?.collectedAt
          ? el('div', { class: 'bottle-date', text: `收藏于 ${formatHourDate(message.bottle.collectedAt)}` })
          : null
      )
    )
  );
}

export async function openCollections(tab = 'collections') {
  bind();
  activeTab = tab === 'bottles' ? 'bottles' : 'collections';
  await render();
  $('#collectionsBackdrop').hidden = false;
  $('#collectionsSheet').hidden = false;
}

export async function drawBottle() {
  const items = await db.getCollections();
  const seen = new Set();
  const candidates = [];

  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (item.role !== 'me') continue;
    const text = String(item.text || '').trim();
    if (!text) continue;
    const key = text.replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ ...item, text });
  }

  if (!candidates.length) return null;

  const recent = (await db.getSetting('recentBottles')) || [];
  const fresh = candidates.filter((item) => !recent.includes(item.id));
  const pool = fresh.length ? fresh : candidates;
  const pick = pool[Math.floor(Math.random() * pool.length)];

  await db.setSetting(
    'recentBottles',
    [pick.id, ...recent.filter((id) => id !== pick.id)].slice(0, 3)
  );

  return {
    collectionId: pick.id,
    text: pick.text,
    collectedAt: pick.collectedAt || null,
  };
}
